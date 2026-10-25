import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRenderer } from '../renderer.js';
import { GameEngine, HIT_WINDOW } from '../game.js';

const makeRenderer = () => Object.assign(Object.create(GameRenderer.prototype), {
  lastArms: 2, motionReduced: false,
});
const makeFlight = () => ({
  due: 3200, created: 0, lanes: [1], fromLanes: [0],
  ballIds: [3], launchTimes: [0], caught: [false], holdStarts: [null],
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≈ ${expected}`);

test('a tossed ball leaves the raised palm and reaches the opposite palm', () => {
  const renderer = makeRenderer();
  const flight = makeFlight();
  const engine = { events: [flight], time: 0 };
  const source = renderer.getArmPose(0, engine, 0);
  const target = renderer.getArmPose(1, engine, 3200);
  const launch = renderer.getBallPosition(flight, 0, 0, engine);
  const arrival = renderer.getBallPosition(flight, 0, 3200, engine);
  near(source.y, renderer.getLanePosition(0).y - 22);
  near(launch.x, source.x);
  near(launch.y, source.y - 10);
  near(arrival.x, target.x);
  near(arrival.y, target.y - 10);
  assert.ok(launch.x < 210 && arrival.x > 210);
});

test('the flight crosses the center above both hands', () => {
  const renderer = makeRenderer();
  const flight = makeFlight();
  const middle = renderer.getBallPosition(flight, 0, 1600);
  assert.ok(Math.abs(middle.x - 210) < 4);
  assert.ok(middle.y < renderer.getLanePosition(0).y - 150);
  assert.ok(renderer.getBallPosition(flight, 0, 800).x < middle.x);
  assert.ok(renderer.getBallPosition(flight, 0, 2400).x > middle.x);
});

test('a catch bends the elbow, dips the hand, and lifts it on the next throw', () => {
  const renderer = makeRenderer();
  const engine = new GameEngine().start();
  engine.update(2100);
  assert.equal(engine.tap(), true);
  const base = renderer.getLanePosition(0);
  const resting = renderer.getArmPose(0, engine, 2100);
  const dip = renderer.getArmPose(0, engine, 2163);
  const throwPose = renderer.getArmPose(0, engine, 2280);
  const recovered = renderer.getArmPose(0, engine, 2600);
  near(resting.y, base.y);
  near(dip.y, base.y + 14);
  near(throwPose.y, base.y - 22);
  assert.ok(dip.elbow.x > resting.elbow.x);
  assert.ok(throwPose.elbow.y < resting.elbow.y);
  near(recovered.y, base.y);
});

test('a returning ball follows its moving palm while held and preserves its pattern', () => {
  const renderer = makeRenderer();
  const engine = new GameEngine().start();
  const incoming = engine.events[0];
  engine.update(incoming.due);
  engine.tap();
  const returned = engine.events.find(event => event.ballIds.includes(incoming.ballIds[0]) && event !== incoming);
  for (const time of [2100, 2163, 2240, 2280]) {
    const palm = renderer.getArmPose(0, engine, time);
    const held = renderer.getBallPosition(returned, 0, time, engine);
    near(held.x, palm.x);
    near(held.y, palm.y - 10);
    assert.equal(held.variant, incoming.ballIds[0] - 1);
  }
});

test('a chord finger caught 100 ms later still gets a complete dip and throw', () => {
  const renderer = makeRenderer();
  near(renderer.getThrowOffset(2200, 2280, 2200), 0);
  near(renderer.getThrowOffset(2228, 2280, 2200), 14);
  near(renderer.getThrowOffset(2280, 2280, 2200), -22);
  near(renderer.getThrowOffset(2600, 2280, 2200), 0);
});

test('adding arms and later arm actions never changes a ball already in flight', () => {
  const renderer = makeRenderer();
  const flight = makeFlight();
  const engine = { events: [flight] };
  const hand = renderer.getLanePosition(0, 2);
  const position = renderer.getBallPosition(flight, 0, 650, engine);
  renderer.lastArms = 12;
  engine.events.push({ ...makeFlight(), due: 5000, launchTimes: [1800], holdStarts: [1000] });
  assert.deepEqual(renderer.getLanePosition(0, 12), hand);
  assert.deepEqual(renderer.getBallPosition(flight, 0, 650, engine), position);
});

test('new balls wait quietly in a hand before beginning the throwing gesture', () => {
  const renderer = makeRenderer();
  const waiting = { ...makeFlight(), created: 800, launchTimes: [800], due: 4000 };
  const source = renderer.getLanePosition(0);
  const position = renderer.getBallPosition(waiting, 0, 500);
  near(position.x, source.x);
  near(position.y, source.y - 10);
  assert.equal(position.fraction, 0);
});

test('opposing balls pass at different heights instead of covering each other', () => {
  const renderer = makeRenderer();
  const firstFlight = makeFlight();
  const opposite = { ...makeFlight(), lanes: [0], fromLanes: [1], ballIds: [4] };
  const first = renderer.getBallPosition(firstFlight, 0, 1600);
  const second = renderer.getBallPosition(opposite, 0, 1600);
  assert.ok(Math.abs(first.x - second.x) < 7);
  assert.ok(Math.abs(first.y - second.y) > 24);
});

test('a receiving palm meets the fixed arrival even while handling another ball', () => {
  const renderer = makeRenderer();
  const incoming = makeFlight();
  const outgoing = { ...makeFlight(), lanes: [0], fromLanes: [1], launchTimes: [3200], due: 6400 };
  const engine = { events: [incoming, outgoing] };
  const hand = renderer.getArmPose(1, engine, 3200);
  const arrival = renderer.getBallPosition(incoming, 0, 3200, engine);
  const release = renderer.getBallPosition(outgoing, 0, 3200, engine);
  near(hand.y, renderer.getLanePosition(1).y);
  near(arrival.x, hand.x);
  near(arrival.y, hand.y - 10);
  near(release.x, hand.x);
  near(release.y, hand.y - 10);
});

test('paused and result poses depend only on the frozen simulation time', () => {
  const renderer = makeRenderer();
  const engine = new GameEngine().start();
  engine.update(450);
  const playing = renderer.getArmPose(0, engine);
  engine.pause();
  engine.update(10000);
  assert.deepEqual(renderer.getArmPose(0, engine), playing);
  engine.phase = 'over';
  assert.deepEqual(renderer.getArmPose(0, engine), playing);
});

test('the menu demonstration also dips, throws, and holds the ball at the palm', () => {
  const renderer = makeRenderer();
  for (const [time, expected] of [[3000, 0], [3070, 14], [3260, -22]]) {
    const demo = renderer.getDemoEngine(time);
    const hand = renderer.getArmPose(1, demo);
    near(hand.offsetY, expected);
    const event = demo.events.find(event => event.ballIds[0] === 1);
    const ball = renderer.getBallPosition(event, 0, time, demo);
    near(ball.x, hand.x);
    near(ball.y, hand.y - 10);
  }
});

test('reduced motion keeps a smaller essential throw with matching ball contact', () => {
  const renderer = makeRenderer();
  renderer.motionReduced = true;
  const flight = makeFlight();
  const engine = { events: [flight], time: 0 };
  const hand = renderer.getArmPose(0, engine);
  const ball = renderer.getBallPosition(flight, 0, 0, engine);
  near(hand.offsetY, -7.7);
  near(ball.x, hand.x);
  near(ball.y, hand.y - 10);
  assert.equal(renderer.getDemoEngine(500).time, renderer.getDemoEngine(1500).time);
});

test('the catch ring uses the same widened timing window as the engine', () => {
  const renderer = makeRenderer();
  const circles = [];
  renderer.ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {},
    arc(...args) { circles.push({ args, strokeStyle: this.strokeStyle }); },
  };
  const flight = makeFlight();
  const engine = { phase: 'playing', events: [flight], time: flight.due - HIT_WINDOW + 10 };
  renderer.drawCatchRings(engine, 2);
  const palm = renderer.getArmPose(1, engine);
  assert.equal(circles[0].strokeStyle, '#bd4d35');
  near(circles[0].args[0], palm.x);
  near(circles[0].args[1], palm.y - 9);
});
