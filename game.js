/** The simulation uses milliseconds, independently of the rendering frame rate. */
export const HIT_WINDOW = 145;
export const CHORD_WINDOW = 40;
export const INITIAL_FLIGHT = 1800;

const EPSILON = 1e-7;
const HOLD_DELAY = 80;
const MIN_GESTURE_GAP = 160;

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
    // A ball keeps its identity and pattern for the entire game.
    this.ballStates = [];
    this._nextId = 1;
    this._nextBallId = 1;
    this._burst = null;
    return this;
  }

  start() {
    this.reset();
    this.phase = 'playing';
    const first = this._newBall();
    const second = this._newBall();
    // One ball is halfway across; the other leaves the opposite hand now.
    this._addEvent(900, [{ ballId: first.id, from: 1, to: 0, launch: -900 }]);
    this._addEvent(1800, [{ ballId: second.id, from: 0, to: 1, launch: 0 }]);
    return this;
  }

  /** Consume full elapsed time and stop at the exact first missed deadline. */
  update(deltaMs) {
    if (this.phase !== 'playing' || !Number.isFinite(deltaMs) || deltaMs < 0) return;
    const target = this.time + deltaMs;
    let missed = null;
    let deadline = Infinity;
    for (const event of this.events) {
      if (!event.caught.some(value => !value)) continue;
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
    this.update(0);
    if (this.phase !== 'playing') return false;

    let event;
    if (this._burst && this.time - this._burst.started <= CHORD_WINDOW + EPSILON) {
      if (this._burst.complete) return false;
      event = this.events.find(item => item.id === this._burst.eventId);
    } else {
      event = this.events.find(item => item.caught.some(value => !value) &&
        Math.abs(item.due - this.time) <= HIT_WINDOW + EPSILON);
      if (!event) {
        this.combo = 0;
        this._emit({ type: 'empty', time: this.time });
        return false;
      }
      this._burst = { eventId: event.id, started: this.time, complete: false, offsets: [] };
    }
    if (!event || Math.abs(event.due - this.time) > HIT_WINDOW + EPSILON) return false;

    let remaining = fingers;
    const caughtNow = [];
    for (let index = 0; index < event.caught.length && remaining > 0; index += 1) {
      if (event.caught[index]) continue;
      event.caught[index] = true;
      caughtNow.push(index);
      this._burst.offsets.push(Math.abs(event.due - this.time));
      remaining -= 1;
    }
    // Return only these physical balls. Even during a partial chord each ball
    // has exactly one next journey; fingers never manufacture extra balls.
    this._returnBalls(event, caughtNow);
    if (event.caught.some(value => !value)) return false;

    this._burst.complete = true;
    const caughtCount = event.lanes.length;
    this.catches += caughtCount;
    this.combo += caughtCount;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    for (const id of event.ballIds) this.ballStates.find(ball => ball.id === id).catches += 1;
    const accuracy = Math.max(0, 1 - Math.max(...this._burst.offsets) / HIT_WINDOW);
    this._emit({ type: 'catch', id: event.id, time: this.time,
      lanes: [...event.lanes], ballIds: [...event.ballIds], count: caughtCount, accuracy });

    const nextBalls = 2 + Math.floor(this.catches / 8);
    if (nextBalls !== this.balls) {
      this.balls = nextBalls;
      this.arms = Math.min(12, Math.max(2, this.balls));
      while (this.ballStates.length < this.balls) this._introduceBall();
      this._emit({ type: 'level', time: this.time, balls: this.balls,
        arms: this.arms, title: getTitle(this.balls) });
    }
    this._sortEvents();
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

  _emit(event) { this.onEvent(event); }

  _miss(event) {
    this.phase = 'over';
    this.combo = 0;
    this._emit({ type: 'miss', id: event.id, time: this.time,
      lanes: event.lanes.filter((_, index) => !event.caught[index]),
      ballIds: event.ballIds.filter((_, index) => !event.caught[index]),
      count: event.caught.filter(value => !value).length });
  }

  _flight() { return Math.max(1050, INITIAL_FLIGHT - (this.balls - 2) * 45); }

  _newBall() {
    const id = this._nextBallId++;
    const ball = { id, variant: id - 1, catches: 0 };
    this.ballStates.push(ball);
    return ball;
  }

  _pick(values) {
    const value = Math.max(0, Math.min(0.999999999, Number(this.random()) || 0));
    return values[Math.floor(value * values.length)];
  }

  _oppositeLanes(fromLanes, occupied = []) {
    const used = new Set(occupied);
    return fromLanes.map(from => {
      const available = Array.from({ length: this.arms }, (_, lane) => lane)
        .filter(lane => lane % 2 !== from % 2 && !used.has(lane));
      const lane = this._pick(available);
      used.add(lane);
      return lane;
    });
  }

  _sortEvents() { this.events.sort((a, b) => a.due - b.due || a.id - b.id); }

  _addEvent(due, journeys = []) {
    const event = { id: this._nextId++, due, lanes: [], fromLanes: [], ballIds: [],
      launchTimes: [], caught: [], created: due };
    for (const journey of journeys) this._appendJourney(event, journey);
    this.events.push(event);
    this._sortEvents();
    return event;
  }

  _appendJourney(event, { ballId, from, to, launch }) {
    event.ballIds.push(ballId);
    event.fromLanes.push(from);
    event.lanes.push(to);
    event.launchTimes.push(launch);
    event.caught.push(false);
    event.created = Math.min(event.created, launch);
  }

  _reserveDue(earliest) {
    let due = earliest;
    // Holding a caught ball longer is preferable to an impossibly short flight
    // or two unrelated gestures less than 160 ms apart.
    for (const event of this.events) {
      if (!event.caught.some(value => !value)) continue;
      if (due > event.due - MIN_GESTURE_GAP + EPSILON &&
          due < event.due + MIN_GESTURE_GAP - EPSILON) due = event.due + MIN_GESTURE_GAP;
    }
    return due;
  }

  _returnBalls(source, indices) {
    if (!indices.length) return;
    let target = this.events.find(event => event.id === source.returnEventId);
    if (!target) {
      const flight = this._flight();
      const earliest = Math.max(this.time, source.due) + HOLD_DELAY + flight;
      const due = this._reserveDue(earliest);
      target = this._addEvent(due);
      target.returnLaunch = due - flight;
      source.returnEventId = target.id;
      source.returnLanes = this._oppositeLanes(source.lanes);
    }
    for (const index of indices) {
      this._appendJourney(target, { ballId: source.ballIds[index],
        from: source.lanes[index], to: source.returnLanes[index], launch: target.returnLaunch });
    }
    this._sortEvents();
  }

  _introduceBall() {
    const ball = this._newBall();
    const maximumGroup = this.balls >= 12 ? 3 : this.balls >= 7 ? 2 : 1;
    const candidates = this.events.filter(event => event.caught.every(value => !value) &&
      !event.returnEventId && (event.reservedCount || event.lanes.length) < maximumGroup);
    // At the third-finger tier, extend an existing pair to a triple first.
    candidates.sort((a, b) => b.lanes.length - a.lanes.length || a.due - b.due);
    const group = maximumGroup > 1 ? candidates[0] : null;
    if (group) {
      this._joinGroup(ball, group);
      return;
    }

    const flight = this._flight();
    const earliest = this.time + HOLD_DELAY + flight;
    const cycle = flight + HOLD_DELAY;
    // Spread early singleton balls through the rhythm, rather than adding a
    // new gesture immediately after every level-up catch.
    const phases = this.events.filter(event => event.caught.some(value => !value))
      .map(event => ((event.due - earliest) % cycle + cycle) % cycle).sort((a, b) => a - b);
    let phase = 0;
    let widest = -1;
    for (let index = 0; index < phases.length; index += 1) {
      const end = phases[(index + 1) % phases.length] + (index === phases.length - 1 ? cycle : 0);
      const gap = end - phases[index];
      if (gap > widest) { widest = gap; phase = (phases[index] + gap / 2) % cycle; }
    }
    const due = this._reserveDue(earliest + phase);
    const from = this._pick(Array.from({ length: this.arms }, (_, lane) => lane));
    const [to] = this._oppositeLanes([from]);
    this._addEvent(due, [{ ballId: ball.id, from, to, launch: due - flight }]);
  }

  _joinGroup(ball, source) {
    const flight = this._flight();
    const earliest = this.time + HOLD_DELAY + flight;
    if (source.due >= earliest - EPSILON) {
      // A distant arrival can take the new ball without moving old journeys.
      const available = Array.from({ length: this.arms }, (_, lane) => lane)
        .filter(lane => !(source.reservedLanes || source.lanes).includes(lane));
      const to = this._pick(available);
      const from = this._pick(Array.from({ length: this.arms }, (_, lane) => lane)
        .filter(lane => lane % 2 !== to % 2));
      this._appendJourney(source, { ballId: ball.id, from, to, launch: source.due - flight });
      if (source.reservedCount) {
        source.reservedCount += 1;
        source.reservedLanes.push(to);
      }
      return;
    }

    // Wait in a hand for this group's NEXT throw. Reserve the full late-catch
    // window, so its latest legal catch still gets a full flight and hold.
    const due = this._reserveDue(Math.max(earliest,
      source.due + HIT_WINDOW + HOLD_DELAY + flight));
    const from = this._pick(Array.from({ length: this.arms }, (_, lane) => lane));
    const destinations = this._oppositeLanes([...source.lanes, from]);
    const target = this._addEvent(due, [{ ballId: ball.id, from,
      to: destinations.at(-1), launch: due - flight }]);
    target.returnLaunch = due - flight;
    target.reservedCount = source.lanes.length + 1;
    target.reservedLanes = [...destinations];
    source.returnEventId = target.id;
    source.returnLanes = destinations.slice(0, -1);
  }
}
