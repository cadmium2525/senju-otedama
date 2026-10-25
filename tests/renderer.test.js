import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRenderer } from '../renderer.js';

const renderer = Object.create(GameRenderer.prototype);
renderer.lastArms = 2;
const flight = {
  due: 1800, created: 0, lanes: [1], fromLanes: [0],
  ballIds: [3], launchTimes: [0], caught: [false],
};

test('a tossed ball leaves one palm and reaches the opposite palm', () => {
  const source = renderer.getLanePosition(0);
  const target = renderer.getLanePosition(1);
  const launch = renderer.getBallPosition(flight, 0, 0);
  const arrival = renderer.getBallPosition(flight, 0, 1800);
  assert.equal(launch.x, source.x);
  assert.equal(launch.y, source.y - 10);
  assert.equal(arrival.x, target.x);
  assert.equal(arrival.y, target.y - 10);
  assert.ok(launch.x < 210 && arrival.x > 210);
});

test('the flight crosses the center above both hands', () => {
  const middle = renderer.getBallPosition(flight, 0, 900);
  assert.ok(Math.abs(middle.x - 210) < 1e-7);
  assert.ok(middle.y < renderer.getLanePosition(0).y - 150);
  assert.ok(renderer.getBallPosition(flight, 0, 450).x < middle.x);
  assert.ok(renderer.getBallPosition(flight, 0, 1350).x > middle.x);
});

test('the returning ball begins at the same hand and keeps its pattern', () => {
  const returned = { ...flight, created: 1800, launchTimes: [1880],
    due: 3680, fromLanes: [1], lanes: [0] };
  const arrival = renderer.getBallPosition(flight, 0, 1800);
  const held = renderer.getBallPosition(returned, 0, 1840);
  assert.equal(held.x, arrival.x);
  assert.equal(held.y, arrival.y);
  assert.equal(held.variant, arrival.variant);
  assert.ok(renderer.getBallPosition(returned, 0, 2780).x < held.x);
});

test('adding arms never moves the hands or a ball already in flight', () => {
  const hand = renderer.getLanePosition(0, 2);
  const position = renderer.getBallPosition(flight, 0, 650);
  renderer.lastArms = 12;
  assert.deepEqual(renderer.getLanePosition(0, 12), hand);
  assert.deepEqual(renderer.getBallPosition(flight, 0, 650), position);
});

test('new balls remain visible in the source hand before their throw', () => {
  const waiting = { ...flight, created: 800, launchTimes: [800], due: 2600 };
  const source = renderer.getLanePosition(0);
  const position = renderer.getBallPosition(waiting, 0, 500);
  assert.equal(position.x, source.x);
  assert.equal(position.y, source.y - 10);
  assert.equal(position.fraction, 0);
});

test('opposing balls pass at different heights instead of covering each other', () => {
  const opposite = { ...flight, lanes: [0], fromLanes: [1], ballIds: [4] };
  const first = renderer.getBallPosition(flight, 0, 900);
  const second = renderer.getBallPosition(opposite, 0, 900);
  assert.ok(Math.abs(first.x - second.x) < 1e-7);
  assert.ok(Math.abs(first.y - second.y) > 24);
});
