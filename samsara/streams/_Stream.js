/* Copyright © 2015-2016 David Valdman */

define(function(require, exports, module){
    var EventHandler = require('../events/EventHandler');
    var StreamContract = require('../streams/_StreamContract');
    var preTickQueue = require('../core/queues/preTickQueue');

    var EVENTS = {
        START : 'start',
        UPDATE : 'update',
        END : 'end',
        SET : 'set'
    };

    /**
     * Stream listens to `start`, `update` and `end` events and
     *  emits `start`, `update` and `end` events.
     *
     *  If listening to multiple sources, Stream emits a single event per
     *  Engine cycle.
     *
     *  @example
     *
     *      var position = new Transitionable([0,0]);
     *      var size = new EventEmitter();
     *
     *      var translationStream = Stream.lift(function(position, size){
     *          var translation = [
     *              position[0] + size[0],
     *              position[1] + size[1]
     *          ];
     *
     *          return Transform.translate(translation);
     *      }, [positionStream, sizeStream]);
     *
     *      translationStream.on('start', function(transform){
     *          console.log(transform);
     *      });
     *
     *      translationStream.on('update', function(transform){
     *          console.log(transform);
     *      });
     *
     *      translationStream.on('end', function(transform){
     *          console.log(transform);
     *      });
     *
     *      position.set([100, 50], {duration : 500});
     *
     * @class Stream
     * @extends Streams.SimpleStream
     * @namespace Streams
     * @param [options] {Object}            Options
     * @param [options.start] {Function}    Custom logic to map the `start` event
     * @param [options.update] {Function}   Custom logic to map the `update` event
     * @param [options.end] {Function}      Custom logic to map the `end` event
     * @constructor
     */
    function Stream(options){
        StreamContract.call(this);

        this._eventInput = new EventHandler();

        options = options || {};

        var startCounter = 0;
        var delayQueue = 0;

        var locked = false;
        var lockedAbove = false;
        var lockCounter = 0;

        var states = {
            set: false,
            start : false,
            update : false,
            end : false,
            prev : ''
        };

        function resolve(data){
            if (states.prev === EVENTS.START && states.set){
                // console.log('BUG!', states);

                // this.emit(EVENTS.UPDATE, data);
                // states.prev = EVENTS.UPDATE;

                // states.start = false;
                // states.update = false;
                // states.end = false;
                // states.set = false;

                // return;
                // debugger
            }

            if (startCounter === 0 && states.update && states.end){
                // update and end called in the same tick when tick should end
                this.emit(EVENTS.UPDATE, data);
                states.prev = EVENTS.UPDATE;
                states.update = false;
            }
            else if (states.prev === EVENTS.START && states.set) {
                states.set = false;
            }
            else if (states.prev !== EVENTS.UPDATE && states.start && states.update){
                // start and update called in the same tick
                this.emit(EVENTS.START, data);
                states.prev = EVENTS.START;
            }

            if (states.update || (states.start && states.end)){
                // call update if updating or if both starting and stopping
                this.emit(EVENTS.UPDATE, data);
                states.prev = EVENTS.UPDATE;
            }
            else if (states.prev !== EVENTS.UPDATE && states.start && !states.end){
                // call start if all have started
                this.emit(EVENTS.START, data);
                states.prev = EVENTS.START;
            }
            else if (startCounter === 0 && states.prev !== EVENTS.START && states.end && !states.start){
                // call end if all have ended
                this.emit(EVENTS.END, data);
                states.prev = EVENTS.END;
            }
            else if (states.prev !== EVENTS.UPDATE && states.set){
                this.emit(EVENTS.SET, data);
                states.prev = EVENTS.SET;
            }

            // reset
            states.start = false;
            states.update = false;
            states.end = false;
            states.set = false;
        }

        var self = this;
        function delay(data){
            if (!locked) {
                locked = true;
                this.emit('lockBelow');
            }

            delayQueue++;
            preTickQueue.push(function(){
                delayQueue--;
                if (delayQueue === 0){
                    locked = false;
                    if (!lockedAbove){
                        self.emit('unlockBelow');
                        resolve.call(self, data);
                    }
                }
            });
        }

        this._eventInput.on(EVENTS.SET, function(data){
            if (options.set) data = options.set(data);
            states.set = true;
            delay.call(this, data);
        }.bind(this));

        this._eventInput.on(EVENTS.START, function(data){
            if (options.start) data = options.start(data);
            states.start = true;
            startCounter++;
            delay.call(this, data);
        }.bind(this));

        this._eventInput.on(EVENTS.END, function(data){
            if (options.end) data = options.end(data);
            states.end = true;
            startCounter--;
            if (startCounter < 0) console.log('fuck');
            delay.call(this, data);
        }.bind(this));

        this._eventInput.on(EVENTS.UPDATE, function(data){
            if (options.update) data = options.update(data);
            states.update = true;
            delay.call(this, data);
        }.bind(this));

        this._eventInput.on('lockBelow', function(){
            lockCounter++;
            lockedAbove = true;
        });

        this._eventInput.on('unlockBelow', function(){
            lockCounter--;
            if (lockCounter === 0){
                lockedAbove = false;
            }
        });
    }

    Stream.prototype = Object.create(StreamContract.prototype);
    Stream.prototype.constructor = Stream;

    Stream.prototype.subscribe = function(source){
        if (source._isActive) this.trigger('start', source.get());
        return EventHandler.prototype.subscribe.apply(this._eventInput, arguments);
    };

    Stream.prototype.unsubscribe = function(source){
        if (!source){
            for (var i = 0; i < this._eventInput.upstream.length; i++){
                var source = this._eventInput.upstream[i]
                this.unsubscribe(source)
            }
        }
        else if (source._isActive) this.trigger('end', source.get());
        return EventHandler.prototype.unsubscribe.apply(this._eventInput, arguments);
    };

    Stream.prototype.trigger = function(type, handler){
        EventHandler.prototype.trigger.apply(this._eventInput, arguments);
    };

    module.exports = Stream;
});