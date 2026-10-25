import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, getTitle, HIT_WINDOW, CHORD_WINDOW } from '../game.js';

function makeEngine() {
  const emitted = [];
  const engine = new GameEngine({ random: () => 0.4, onEvent: event => emitted.push(event) });
  return { engine, emitted };
}

function catchNext(engine, { fingers, offset = 0 } = {}) {
  const next = engine.events.find(event => event.caught.some(value => !value));
  engine.update(next.due + offset - engine.time);
  return engine.tap(fingers ?? next.lanes.length);
}

function reachBalls(engine, target) {
  while (engine.phase === 'playing' && engine.balls < target) catchNext(engine);
  assert.equal(engine.phase, 'playing');
  assert.ok(engine.balls >= target);
}

function nextChord(engine, size) {
  let next;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    next = engine.events.find(event => event.caught.some(value => !value));
    if (next.lanes.length === size) return next;
    catchNext(engine);
  }
  assert.fail(`No ${size}-finger group was generated`);
}

test('start exposes two visible balls, queued targets, and resettable public state', () => {
  const { engine } = makeEngine();
  assert.equal(engine.phase, 'menu');
  engine.start();
  assert.equal(engine.phase, 'playing');
  assert.equal(engine.balls, 2);
  assert.equal(engine.arms, 2);
  assert.equal(engine.events.filter(event => event.created <= engine.time).length, 2);
  assert.ok(engine.events.length >= 4);
  catchNext(engine);
  engine.reset();
  assert.equal(engine.phase, 'menu');
  assert.equal(engine.time, 0);
  assert.equal(engine.catches, 0);
  assert.equal(engine.maxCombo, 0);
  assert.deepEqual(engine.events, []);
});

test('both exact timing boundaries count as catches', () => {
  for (const offset of [-HIT_WINDOW, HIT_WINDOW]) {
    const { engine, emitted } = makeEngine();
    engine.start();
    assert.equal(catchNext(engine, { offset }), true);
    assert.equal(engine.phase, 'playing');
    assert.equal(engine.catches, 1);
    assert.equal(emitted.find(event => event.type === 'catch').accuracy, 0);
  }
});

test('an early empty tap breaks the combo but does not end the game', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  catchNext(engine);
  engine.update(CHORD_WINDOW + 1);
  assert.equal(engine.tap(), false);
  assert.equal(engine.combo, 0);
  assert.equal(engine.maxCombo, 1);
  assert.equal(engine.phase, 'playing');
  assert.equal(emitted.at(-1).type, 'empty');
});

test('one missed ball ends play at the exact deadline, including a long frame', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  const deadline = engine.events[0].due + HIT_WINDOW;
  engine.update(60_000);
  assert.equal(engine.phase, 'over');
  assert.equal(engine.time, deadline);
  assert.equal(emitted.at(-1).type, 'miss');
  assert.equal(emitted.at(-1).count, 1);
  engine.update(1000);
  engine.tap(3);
  assert.equal(engine.time, deadline);
  assert.equal(engine.catches, 0);
});

test('an incomplete two-finger gesture misses after the aggregation window', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  engine.update(chord.due - engine.time);
  assert.equal(engine.tap(1), false);
  assert.deepEqual(chord.caught, [true, false]);
  engine.update(CHORD_WINDOW + 0.01);
  assert.equal(engine.phase, 'over');
  assert.equal(engine.time, chord.due + CHORD_WINDOW);
  assert.equal(emitted.at(-1).count, 1);
});

test('two simultaneous fingers catch a pair once', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  const previous = engine.catches;
  engine.update(chord.due - engine.time);
  assert.equal(engine.tap(2), true);
  assert.equal(engine.catches, previous + 2);
  assert.deepEqual(chord.caught, [true, true]);
  const caught = emitted.findLast(event => event.type === 'catch');
  assert.equal(caught.id, chord.id);
  assert.equal(caught.count, 2);
});

test('separate pointer inputs at exactly 40 ms form one chord', () => {
  const { engine } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  engine.update(chord.due - engine.time);
  engine.tap();
  engine.update(CHORD_WINDOW);
  assert.equal(engine.tap(), true);
  assert.equal(engine.phase, 'playing');
});

test('a second finger later than 40 ms cannot complete a chord', () => {
  const { engine } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  engine.update(chord.due - engine.time);
  engine.tap();
  engine.update(CHORD_WINDOW + 0.001);
  assert.equal(engine.tap(), false);
  assert.equal(engine.phase, 'over');
});

test('extra fingers cannot pre-catch the following group', () => {
  const { engine } = makeEngine();
  engine.start();
  engine.update(engine.events[0].due);
  const next = engine.events[1];
  engine.tap(3);
  engine.tap(3);
  assert.equal(engine.catches, 1);
  assert.deepEqual(next.caught, [false]);
});

test('every eight catches adds a ball, increases arms, and eventually creates triples', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  for (let count = 0; count < 7; count += 1) catchNext(engine);
  assert.equal(engine.balls, 2);
  catchNext(engine);
  assert.equal(engine.balls, 3);
  assert.equal(engine.arms, 3);
  assert.equal(emitted.filter(event => event.type === 'level').length, 1);
  reachBalls(engine, 12);
  const chord = nextChord(engine, 3);
  assert.equal(new Set(chord.lanes).size, 3);
  assert.ok(chord.lanes.every(lane => lane >= 0 && lane < engine.arms));
  assert.equal(catchNext(engine), true);
  assert.equal(engine.arms, 12);
  reachBalls(engine, 14);
  assert.equal(engine.arms, 12);
  const upcoming = engine.events.filter(event => event.caught.some(value => !value));
  assert.ok(upcoming.at(-1).due - upcoming.at(-1).created < 1800);
});

test('pause freezes time and input until resumed', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  engine.update(500);
  engine.pause();
  engine.update(10_000);
  assert.equal(engine.time, 500);
  assert.equal(engine.tap(), false);
  assert.equal(engine.catches, 0);
  assert.equal(engine.phase, 'paused');
  engine.resume();
  assert.equal(catchNext(engine), true);
  assert.deepEqual(emitted.filter(event => ['pause', 'resume'].includes(event.type))
    .map(event => event.type), ['pause', 'resume']);
});

test('high-level queues schedule complete future flights without late appearances', () => {
  const { engine } = makeEngine();
  engine.start();
  let lastId = Math.max(...engine.events.map(event => event.id));
  for (let attempt = 0; attempt < 400 && engine.balls < 30; attempt += 1) {
    // Exercise both edges of the legal timing window as well as exact taps.
    const desiredOffset = engine.catches % 3 === 0 ? HIT_WINDOW :
      engine.catches % 3 === 1 ? -HIT_WINDOW : 0;
    const next = engine.events.find(event => event.caught.some(value => !value));
    // Nearby targets can have overlapping hit windows. Keep gestures in order.
    const target = Math.max(next.due + desiredOffset, engine.time + CHORD_WINDOW + 1);
    catchNext(engine, { offset: target - next.due });
    assert.equal(engine.phase, 'playing');
    const pending = engine.events.filter(event => event.caught.some(value => !value));
    assert.ok(pending.length >= Math.max(4, Math.min(engine.balls, 12) + 2));
    for (const event of engine.events.filter(event => event.id > lastId)) {
      assert.ok(event.created >= engine.time - 1e-7,
        `Ball ${event.id} at level ${engine.balls} started before it was generated`);
      assert.ok(event.created < event.due);
    }
    lastId = Math.max(...engine.events.map(event => event.id));
  }
  assert.ok(engine.balls >= 30);
});

test('30 fps and 60 fps produce identical catches, progression, and miss time', () => {
  function simulate(fps) {
    const { engine, emitted } = makeEngine();
    engine.start();
    for (let round = 0; round < 95; round += 1) {
      const next = engine.events.find(event => event.caught.some(value => !value));
      const target = next.due - 30;
      while (engine.time + 1000 / fps < target) engine.update(1000 / fps);
      engine.update(target - engine.time);
      engine.tap(next.lanes.length);
      assert.equal(engine.phase, 'playing');
    }
    while (engine.phase === 'playing') engine.update(1000 / fps);
    return {
      phase: engine.phase, time: engine.time, balls: engine.balls,
      catches: engine.catches, maxCombo: engine.maxCombo,
      events: emitted,
    };
  }
  assert.deepEqual(simulate(30), simulate(60));
});

test('the two-finger tier varies its rhythm while preserving gesture separation', () => {
  const { engine } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  let sample = 0;
  engine.random = () => (sample++ % 5) / 4;
  const intervals = [];
  while (engine.catches < 47) {
    const previousDue = engine.events.at(-1).due;
    catchNext(engine);
    intervals.push(engine.events.at(-1).due - previousDue);
  }
  assert.ok(intervals.every(interval => interval >= 160));
  assert.ok(Math.max(...intervals) > Math.min(...intervals));
});

test('titles follow the four difficulty tiers', () => {
  assert.equal(getTitle(2), '微笑みの観音');
  assert.equal(getTitle(3), '微笑みの観音');
  assert.equal(getTitle(4), 'そわそわの観音');
  assert.equal(getTitle(6), 'そわそわの観音');
  assert.equal(getTitle(7), '汗かきの観音');
  assert.equal(getTitle(11), '汗かきの観音');
  assert.equal(getTitle(12), '滝汗の観音');
});
