import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, getTitle, HIT_WINDOW, CHORD_WINDOW, INITIAL_FLIGHT } from '../game.js';

function makeEngine(random = () => 0.4) {
  const emitted = [];
  const engine = new GameEngine({ random, onEvent: event => emitted.push(event) });
  return { engine, emitted };
}

function pending(engine) { return engine.events.filter(event => event.caught.some(value => !value)); }
function nextEvent(engine) { return pending(engine)[0]; }
function catchNext(engine, { fingers, offset = 0 } = {}) {
  const next = nextEvent(engine);
  engine.update(next.due + offset - engine.time);
  return engine.tap(fingers ?? next.lanes.length);
}
function reachBalls(engine, target) {
  for (let attempt = 0; attempt < 500 && engine.balls < target; attempt += 1) catchNext(engine);
  assert.equal(engine.phase, 'playing');
  assert.ok(engine.balls >= target);
}
function nextChord(engine, size) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const next = nextEvent(engine);
    if (next.lanes.length === size) return next;
    catchNext(engine);
  }
  assert.fail(`No ${size}-finger group was generated`);
}
function assertPhysicalBalls(engine) {
  assert.equal(engine.ballStates.length, engine.balls);
  assert.equal(new Set(engine.ballStates.map(ball => ball.id)).size, engine.balls);
  const inPlay = [];
  for (const event of pending(engine)) {
    assert.ok(event.lanes.length >= 1 && event.lanes.length <= 3);
    assert.equal(event.lanes.length, event.ballIds.length);
    assert.equal(event.fromLanes.length, event.ballIds.length);
    assert.equal(event.launchTimes.length, event.ballIds.length);
    assert.equal(new Set(event.lanes).size, event.lanes.length, 'a hand catches only one ball in a group');
    for (let index = 0; index < event.ballIds.length; index += 1) {
      assert.ok(event.lanes[index] >= 0 && event.lanes[index] < engine.arms);
      assert.ok(event.fromLanes[index] >= 0 && event.fromLanes[index] < engine.arms);
      assert.notEqual(event.fromLanes[index] % 2, event.lanes[index] % 2);
      assert.ok(event.due - event.launchTimes[index] >= 1050 - 1e-7);
      if (!event.caught[index]) inPlay.push(event.ballIds[index]);
    }
  }
  assert.equal(inPlay.length, engine.balls, 'one pending journey per physical ball');
  assert.equal(new Set(inPlay).size, engine.balls, 'a ball never flies twice at once');
  assert.deepEqual([...inPlay].sort((a, b) => a - b), engine.ballStates.map(ball => ball.id));
  const dueTimes = pending(engine).map(event => event.due);
  assert.deepEqual([...dueTimes].sort((a, b) => a - b), dueTimes);
  for (let index = 1; index < dueTimes.length; index += 1) {
    assert.ok(dueTimes[index] - dueTimes[index - 1] >= 160 - 1e-7);
  }
}

test('start has two real crossing balls with complete flights and resettable state', () => {
  const { engine } = makeEngine();
  assert.equal(engine.phase, 'menu');
  engine.start();
  assert.equal(engine.phase, 'playing');
  assert.equal(engine.arms, 2);
  assert.deepEqual(engine.events.map(event => event.ballIds), [[1], [2]]);
  assert.deepEqual(engine.events.map(event => event.fromLanes), [[1], [0]]);
  assert.deepEqual(engine.events.map(event => event.lanes), [[0], [1]]);
  assert.deepEqual(engine.events.map(event => event.launchTimes), [[-900], [0]]);
  assert.deepEqual(engine.events.map(event => event.due), [900, 1800]);
  assert.ok(engine.events.every(event => event.due - event.created === INITIAL_FLIGHT));
  assertPhysicalBalls(engine);
  catchNext(engine);
  engine.reset();
  assert.equal(engine.phase, 'menu');
  assert.equal(engine.time, 0);
  assert.equal(engine.catches, 0);
  assert.equal(engine.maxCombo, 0);
  assert.deepEqual(engine.events, []);
  assert.deepEqual(engine.ballStates, []);
});

test('a caught ball leaves that same hand for the opposite side with the same identity and pattern', () => {
  const { engine } = makeEngine();
  engine.start();
  for (let round = 0; round < 60; round += 1) {
    const caught = nextEvent(engine);
    const previous = caught.ballIds.map((id, index) => ({ id, hand: caught.lanes[index],
      variant: engine.ballStates.find(ball => ball.id === id).variant }));
    assert.equal(catchNext(engine), true);
    for (const ball of previous) {
      const next = pending(engine).find(event => event.ballIds.includes(ball.id));
      const index = next.ballIds.indexOf(ball.id);
      assert.equal(next.fromLanes[index], ball.hand);
      assert.notEqual(next.lanes[index] % 2, ball.hand % 2);
      assert.equal(engine.ballStates.find(item => item.id === ball.id).variant, ball.variant);
      assert.ok(next.launchTimes[index] >= engine.time + 80 - 1e-7);
    }
    assertPhysicalBalls(engine);
  }
});

test('both exact timing boundaries count as catches and return full flights', () => {
  for (const offset of [-HIT_WINDOW, HIT_WINDOW]) {
    const { engine, emitted } = makeEngine();
    engine.start();
    assert.equal(catchNext(engine, { offset }), true);
    assert.equal(engine.phase, 'playing');
    assert.equal(engine.catches, 1);
    assert.equal(emitted.find(event => event.type === 'catch').accuracy, 0);
    const returned = pending(engine).find(event => event.ballIds.includes(1));
    assert.ok(returned.launchTimes[0] >= engine.time + 80);
    assert.equal(returned.due - returned.launchTimes[0], INITIAL_FLIGHT);
    assertPhysicalBalls(engine);
  }
});

test('an empty tap breaks combo without ending play or creating balls', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  catchNext(engine);
  engine.update(CHORD_WINDOW + 1);
  assert.equal(engine.tap(), false);
  assert.equal(engine.combo, 0);
  assert.equal(engine.maxCombo, 1);
  assert.equal(engine.phase, 'playing');
  assert.equal(emitted.at(-1).type, 'empty');
  assertPhysicalBalls(engine);
});

test('one missed ball stops at its exact deadline even during a long frame', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  const deadline = nextEvent(engine).due + HIT_WINDOW;
  engine.update(60_000);
  assert.equal(engine.phase, 'over');
  assert.equal(engine.time, deadline);
  assert.equal(emitted.at(-1).type, 'miss');
  assert.deepEqual(emitted.at(-1).ballIds, [1]);
  engine.update(1000);
  engine.tap(3);
  assert.equal(engine.time, deadline);
  assert.equal(engine.catches, 0);
});

test('every eight successful catches introduces exactly one new physical ball', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  let previous = 2;
  while (engine.balls < 35) {
    catchNext(engine);
    assert.equal(engine.balls, 2 + Math.floor(engine.catches / 8));
    if (engine.balls !== previous) {
      assert.equal(engine.balls, previous + 1);
      previous = engine.balls;
    }
    assert.equal(engine.arms, Math.min(12, engine.balls));
    assertPhysicalBalls(engine);
  }
  assert.equal(emitted.filter(event => event.type === 'level').length, 33);
});

test('the two-finger tier joins two distinct balls and keeps that group on return', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  assert.equal(engine.balls, 7);
  assert.equal(new Set(chord.ballIds).size, 2);
  assert.equal(new Set(chord.lanes).size, 2);
  const previous = engine.catches;
  engine.update(chord.due - engine.time);
  assert.equal(engine.tap(2), true);
  assert.equal(engine.catches, previous + 2);
  const returned = pending(engine).find(event => event.ballIds.includes(chord.ballIds[0]));
  assert.ok(chord.ballIds.every(id => returned.ballIds.includes(id)));
  assert.equal(emitted.findLast(event => event.type === 'catch').count, 2);
  assertPhysicalBalls(engine);
});

test('separate pointer inputs exactly 40 ms apart form one chord without duplicate flights', () => {
  const { engine } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  engine.update(chord.due - engine.time);
  const catches = engine.catches;
  assert.equal(engine.tap(), false);
  assert.deepEqual(chord.caught, [true, false]);
  assert.equal(engine.catches, catches);
  assertPhysicalBalls(engine);
  engine.update(CHORD_WINDOW);
  assert.equal(engine.tap(), true);
  assert.equal(engine.catches, catches + 2);
  assertPhysicalBalls(engine);
});

test('an incomplete chord misses exactly 40 ms after its first finger', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  engine.update(chord.due - engine.time);
  engine.tap();
  engine.update(CHORD_WINDOW + 0.001);
  assert.equal(engine.phase, 'over');
  assert.equal(engine.time, chord.due + CHORD_WINDOW);
  assert.equal(emitted.at(-1).count, 1);
  assert.equal(engine.tap(), false);
});

test('a late chord still respects the outer 145 ms catch deadline', () => {
  const { engine } = makeEngine();
  engine.start();
  reachBalls(engine, 7);
  const chord = nextChord(engine, 2);
  engine.update(chord.due + HIT_WINDOW - 10 - engine.time);
  engine.tap();
  engine.update(10.001);
  assert.equal(engine.phase, 'over');
  assert.equal(engine.time, chord.due + HIT_WINDOW);
});

test('extra fingers cannot pre-catch another arrival or manufacture balls', () => {
  const { engine } = makeEngine();
  engine.start();
  const second = engine.events[1];
  engine.update(900);
  engine.tap(3);
  engine.tap(3);
  assert.equal(engine.catches, 1);
  assert.deepEqual(second.caught, [false]);
  assertPhysicalBalls(engine);
});

test('the three-finger tier creates three real opposite-hand journeys', () => {
  const { engine } = makeEngine();
  engine.start();
  reachBalls(engine, 12);
  const chord = nextChord(engine, 3);
  assert.ok(engine.balls >= 12);
  assert.equal(new Set(chord.ballIds).size, 3);
  assert.equal(new Set(chord.lanes).size, 3);
  assert.equal(catchNext(engine), true);
  assertPhysicalBalls(engine);
});

test('pause freezes the clock, held balls, flight paths, and input until resumed', () => {
  const { engine, emitted } = makeEngine();
  engine.start();
  engine.update(500);
  engine.pause();
  const routes = JSON.stringify(engine.events);
  engine.update(10_000);
  assert.equal(engine.time, 500);
  assert.equal(engine.tap(), false);
  assert.equal(JSON.stringify(engine.events), routes);
  engine.resume();
  assert.equal(catchNext(engine), true);
  assert.deepEqual(emitted.filter(event => ['pause', 'resume'].includes(event.type))
    .map(event => event.type), ['pause', 'resume']);
});

test('early and late catches through crowded tiers keep complete flights and separate gestures', () => {
  let seed = 21;
  const { engine } = makeEngine(() => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646);
  engine.start();
  for (let attempt = 0; attempt < 350 && engine.balls < 35; attempt += 1) {
    const next = nextEvent(engine);
    const desired = attempt % 3 === 0 ? HIT_WINDOW : attempt % 3 === 1 ? -HIT_WINDOW : 0;
    const target = Math.max(next.due + desired, engine.time + CHORD_WINDOW + 1);
    const priorIds = new Set(engine.events.map(event => event.id));
    catchNext(engine, { offset: target - next.due });
    assert.equal(engine.phase, 'playing');
    assertPhysicalBalls(engine);
    for (const event of engine.events.filter(event => !priorIds.has(event.id))) {
      assert.ok(event.launchTimes.every(launch => launch >= engine.time + 80 - 1e-7));
      assert.ok(event.launchTimes.every(launch => event.due - launch >= 1050 - 1e-7));
    }
  }
  assert.ok(engine.balls >= 35);
});

test('30 fps and 60 fps have identical catches, progression, identities, and miss time', () => {
  function simulate(fps) {
    const { engine, emitted } = makeEngine();
    engine.start();
    for (let round = 0; round < 95; round += 1) {
      const next = nextEvent(engine);
      const target = next.due - 30;
      while (engine.time + 1000 / fps < target) engine.update(1000 / fps);
      engine.update(target - engine.time);
      assert.equal(engine.tap(next.lanes.length), true);
      assert.equal(engine.phase, 'playing');
    }
    while (engine.phase === 'playing') engine.update(1000 / fps);
    return { phase: engine.phase, time: engine.time, balls: engine.balls,
      catches: engine.catches, maxCombo: engine.maxCombo, pool: engine.ballStates, events: emitted };
  }
  assert.deepEqual(simulate(30), simulate(60));
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
