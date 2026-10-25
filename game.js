/** The simulation uses milliseconds, independently of the rendering frame rate. */
export const HIT_WINDOW = 145;
export const CHORD_WINDOW = 40;
export const INITIAL_FLIGHT = 1800;

const EPSILON = 1e-7;
const MIN_QUEUED_GROUPS = 4;

export function getTitle(balls) {
  if (balls >= 12) return '滝汗の観音';
  if (balls >= 7) return '汗かきの観音';
  if (balls >= 4) return 'そわそわの観音';
  return '微笑みの観音';
}

export class GameEngine {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.phase = 'menu';
    this.time = 0;
    this.balls = 2;
    this.catches = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.arms = 2;
    this.events = [];
    this._nextId = 1;
    this._lastDue = 0;
    this._burst = null;
    return this;
  }

  start() {
    this.reset();
    this.phase = 'playing';
    // Two balls are already in flight. The first is a gentle warm-up catch.
    this._addEvent(900, 0);
    this._addEvent(1800, 0);
    this._fillQueue();
    return this;
  }

  /**
   * Consume the full elapsed time, including long frames. A missed ball stops
   * simulation at its exact deadline; elapsed time is never silently capped.
   * Paused time is ignored, so callers should reset their frame clock on resume.
   */
  update(deltaMs) {
    if (this.phase !== 'playing' || !Number.isFinite(deltaMs) || deltaMs < 0) return;
    const target = this.time + deltaMs;
    const pending = this.events.filter(event => event.caught.some(value => !value));
    let missed = null;
    let deadline = Infinity;

    for (const event of pending) {
      let eventDeadline = event.due + HIT_WINDOW;
      if (this._burst?.eventId === event.id && !this._burst.complete) {
        eventDeadline = Math.min(eventDeadline, this._burst.started + CHORD_WINDOW);
      }
      if (eventDeadline < deadline) {
        deadline = eventDeadline;
        missed = event;
      }
    }

    if (missed && target > deadline + EPSILON) {
      this.time = deadline;
      this._miss(missed);
      return;
    }

    this.time = target;
    this.events = this.events.filter(event =>
      event.caught.some(value => !value) || event.due + 350 >= this.time
    );
  }

  /** One call may represent several simultaneous fingers. */
  tap(count = 1) {
    if (this.phase !== 'playing' || !Number.isFinite(count) || count < 1) return false;
    const fingers = Math.floor(count);
    // Process a deadline even when the caller invokes input between frames.
    this.update(0);
    if (this.phase !== 'playing') return false;

    let event;
    if (this._burst && this.time - this._burst.started <= CHORD_WINDOW + EPSILON) {
      // Extra fingers belong to this same gesture, never to a following ball.
      if (this._burst.complete) return false;
      event = this.events.find(item => item.id === this._burst.eventId);
    } else {
      event = this.events.find(item =>
        item.caught.some(value => !value) &&
        Math.abs(item.due - this.time) <= HIT_WINDOW + EPSILON
      );
      if (!event) {
        this.combo = 0;
        this._emit({ type: 'empty', time: this.time });
        return false;
      }
      this._burst = { eventId: event.id, started: this.time, complete: false, offsets: [] };
    }

    if (!event || Math.abs(event.due - this.time) > HIT_WINDOW + EPSILON) return false;

    let remaining = fingers;
    for (let index = 0; index < event.caught.length && remaining > 0; index += 1) {
      if (!event.caught[index]) {
        event.caught[index] = true;
        this._burst.offsets.push(Math.abs(event.due - this.time));
        remaining -= 1;
      }
    }

    if (event.caught.some(value => !value)) return false;

    this._burst.complete = true;
    const caughtCount = event.lanes.length;
    this.catches += caughtCount;
    this.combo += caughtCount;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const accuracy = Math.max(0, 1 - Math.max(...this._burst.offsets) / HIT_WINDOW);
    this._emit({
      type: 'catch', id: event.id, time: this.time,
      lanes: [...event.lanes], count: caughtCount, accuracy,
    });

    const nextBalls = 2 + Math.floor(this.catches / 8);
    if (nextBalls !== this.balls) {
      this.balls = nextBalls;
      this.arms = Math.min(12, Math.max(2, this.balls));
      this._emit({ type: 'level', time: this.time, balls: this.balls,
        arms: this.arms, title: getTitle(this.balls) });
    }
    this._fillQueue();
    return true;
  }

  pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this._emit({ type: 'pause', time: this.time });
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this._emit({ type: 'resume', time: this.time });
  }

  _emit(event) {
    this.onEvent(event);
  }

  _miss(event) {
    this.phase = 'over';
    this.combo = 0;
    this._emit({ type: 'miss', id: event.id, time: this.time,
      lanes: event.lanes.filter((_, index) => !event.caught[index]),
      count: event.caught.filter(value => !value).length });
  }

  _flight() {
    return Math.max(1050, INITIAL_FLIGHT - (this.balls - 2) * 45);
  }

  _fillQueue() {
    // Queue a full flight plus two groups before it begins. At high levels a
    // fixed four groups would launch balls after their flight already started.
    // The count depends on level, never on the rendering frame rate.
    const queuedGroups = Math.max(MIN_QUEUED_GROUPS, Math.min(this.balls, 12) + 2);
    while (this.events.filter(event => event.caught.some(value => !value)).length < queuedGroups) {
      // A little rhythmic variation arrives with the first two-finger tier.
      // Keep a minimum separation so consecutive gestures remain distinct.
      const variation = this.balls >= 7 ? 0.9 + Math.max(0, Math.min(1, Number(this.random()) || 0)) * 0.25 : 1;
      const interval = Math.max(160, this._flight() / Math.min(this.balls, 12) * variation);
      const due = this._lastDue + interval;
      this._addEvent(due, Math.max(0, due - this._flight()));
    }
  }

  _addEvent(due, created) {
    const id = this._nextId++;
    let count = 1;
    if (this.balls >= 12 && id % 3 === 0) count = 3;
    else if (this.balls >= 7 && id % 2 === 0) count = 2;
    const available = Array.from({ length: this.arms }, (_, index) => index);
    const lanes = [];
    for (let index = 0; index < count; index += 1) {
      const value = Math.max(0, Math.min(0.999999999, Number(this.random()) || 0));
      const selected = Math.floor(value * available.length);
      lanes.push(available.splice(selected, 1)[0]);
    }
    this.events.push({ id, due, lanes, caught: lanes.map(() => false), created });
    this._lastDue = due;
  }
}
