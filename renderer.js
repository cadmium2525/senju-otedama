import { HIT_WINDOW, INITIAL_FLIGHT } from './game.js?v=3';

const W = 420;
const H = 760;
const INK = '#244f48';
const GOLD = '#c29b51';
const CREAM = '#f6efdf';
const VERMILION = '#bd4d35';
const TAU = Math.PI * 2;
// Add new hands between the old ones; existing hands never slide during a toss.
const PALM_ANGLES = [24, -8, 54, 8, 74, 40];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (from, to, fraction) => from + (to - from) * smooth(fraction);
const THROW_RECOVERY = 320;

/** A resolution-independent, deliberately asset-free picture book stage. */
export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lastArms = 2;
    this.resultBalls = 2;
    this.effects = [];
    this.motionReduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width || W);
    const height = Math.max(1, rect.height || H);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.sx = this.canvas.width / W;
    this.sy = this.canvas.height / H;
  }

  getLanePosition(lane, arms = this.lastArms) {
    const pair = Math.floor(lane / 2);
    const angle = PALM_ANGLES[pair % PALM_ANGLES.length] * Math.PI / 180;
    const side = lane % 2 === 0 ? -1 : 1;
    return {
      x: 210 + side * (155 * Math.cos(angle)),
      y: 475 - 119 * Math.sin(angle),
      side,
      angle,
    };
  }

  lanePositions(arms = this.lastArms) {
    return Array.from({ length: Math.min(24, Math.max(2, arms)) }, (_, lane) => this.getLanePosition(lane, arms));
  }

  /** The hand reacts on simulation time, so pausing also pauses the gesture. */
  getArmPose(lane, engine, time = engine.time || 0) {
    const base = this.getLanePosition(lane);
    let dy = 0;
    for (const event of engine.events || []) {
      for (let index = 0; index < (event.lanes?.length || 0); index++) {
        if ((event.fromLanes?.[index] ?? (event.lanes[index] ^ 1)) !== lane) continue;
        const launch = event.launchTimes?.[index] ?? event.created ?? event.due - INITIAL_FLIGHT;
        const caughtAt = event.holdStarts?.[index];
        const offset = this.getThrowOffset(time, launch, caughtAt);
        // Several balls can use one hand. Keep its gesture small and readable.
        if (Math.abs(offset) > Math.abs(dy)) dy = offset;
      }
    }
    // A receiving palm returns to its resting position at contact. This also
    // lets a busy hand receive another ball without bending a flying ball's arc.
    for (const event of engine.events || []) {
      for (let index = 0; index < (event.lanes?.length || 0); index++) {
        if (event.lanes[index] !== lane) continue;
        const catchTime = event.catchTimes?.[index];
        if (event.caught?.[index] && Number.isFinite(catchTime) && time >= catchTime) continue;
        dy *= smooth(Math.abs(time - event.due) / 140);
      }
    }
    dy *= this.motionReduced ? 0.35 : 1;
    const lift = clamp(-dy / 22);
    const x = base.x - base.side * lift * 6;
    const y = base.y + dy;
    return {
      ...base, x, y, offsetY: dy,
      rotation: -base.side * lift * 0.13,
      shoulder: { x: 210 + base.side * 27, y: 505 + Math.floor(lane / 2) * 2 },
      elbow: { x: base.x - base.side * (24 + Math.abs(dy) * 0.32), y: base.y + 62 + dy * 0.45 },
      wrist: { x, y: y + 12 },
    };
  }

  getThrowOffset(time, launch, caughtAt) {
    const sinceThrow = time - launch;
    if (sinceThrow >= 0) {
      return sinceThrow <= THROW_RECOVERY ? mix(-22, 0, sinceThrow / THROW_RECOVERY) : 0;
    }
    const held = Number.isFinite(caughtAt) ? launch - caughtAt : Infinity;
    if (held < 360 && time >= caughtAt) {
      const dipAt = caughtAt + Math.min(70, held * 0.35);
      const liftAt = Math.max(dipAt, launch - 70);
      if (time < dipAt) return mix(0, 14, (time - caughtAt) / (dipAt - caughtAt));
      if (time < liftAt) return mix(14, 10, (time - dipAt) / (liftAt - dipAt));
      return mix(liftAt > dipAt ? 10 : 14, -22, (time - liftAt) / (launch - liftAt));
    }
    if (sinceThrow >= -180) {
      return sinceThrow < -90 ? mix(0, 10, (sinceThrow + 180) / 90)
        : mix(10, -22, (sinceThrow + 90) / 90);
    }
    if (Number.isFinite(caughtAt) && time >= caughtAt && time <= caughtAt + 180) {
      return Math.sin((time - caughtAt) / 180 * Math.PI) * 14;
    }
    return 0;
  }

  getDemoEngine(now) {
    const time = this.motionReduced ? 0 : now;
    const flight = 3000;
    const hold = 260;
    const cycle = flight + hold;
    const events = [];
    for (let index = 0; index < 2; index++) {
      const offset = index * cycle / 2;
      let turn = Math.floor((time + offset) / cycle);
      let launch = turn * cycle - offset;
      if (time >= launch + flight) { turn++; launch += cycle; }
      const from = ((turn + index) % 2 + 2) % 2;
      events.push({ due: launch + flight, created: launch,
        fromLanes: [from], lanes: [from ^ 1], launchTimes: [launch],
        ballIds: [index + 1], caught: [false], holdStarts: [launch - hold] });
    }
    return { phase: 'menu', time, events };
  }

  burst(lanes, success = true) {
    const now = performance.now();
    for (const lane of lanes) {
      const pose = this.lastEngine ? this.getArmPose(lane, this.lastEngine) : this.getLanePosition(lane);
      this.effects.push({ ...pose, lane, success, start: now });
    }
  }

  setResultFace(balls) {
    this.resultBalls = balls;
  }

  draw(engine, nowMs = performance.now()) {
    const c = this.ctx;
    c.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    c.clearRect(0, 0, W, H);
    const active = engine.phase === 'playing' || engine.phase === 'paused';
    const poseEngine = active || engine.phase === 'over' ? engine : this.getDemoEngine(nowMs);
    this.lastEngine = poseEngine;
    const arms = Math.min(24, Math.max(2, active ? engine.arms || 2 : engine.phase === 'over' ? engine.arms || 2 : 2));
    this.lastArms = arms;
    this.drawBackground(nowMs, active);
    this.drawHalo(nowMs, active);
    this.drawArms(arms, poseEngine, nowMs);
    this.drawLotus(nowMs);
    this.drawBody();
    this.drawNecklace();
    this.drawHead(active ? engine.balls || 2 : engine.phase === 'over' ? engine.balls || this.resultBalls : 2, nowMs);
    this.drawCatchRings(engine, arms);
    this.drawBalls(engine, nowMs, active || engine.phase === 'over', arms);
    this.drawEffects(nowMs);
    this.drawForeground();
  }

  drawBackground(now, active) {
    const c = this.ctx;
    const wash = c.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, '#faf5e9');
    wash.addColorStop(0.58, CREAM);
    wash.addColorStop(1, '#eee4cd');
    c.fillStyle = wash;
    c.fillRect(0, 0, W, H);

    // Fine paper flecks are deterministic, so the background never shimmers.
    c.fillStyle = 'rgba(122, 101, 62, .055)';
    for (let i = 0; i < 240; i++) {
      const x = (i * 73.61 + 17) % W;
      const y = (i * 119.31 + 13) % H;
      c.fillRect(x, y, 0.7 + i % 2, 0.65);
    }

    c.save();
    c.strokeStyle = 'rgba(194,155,81,.11)';
    c.lineWidth = 0.7;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 8; col++) {
        const x = col * 64 - 14 + (row % 2) * 32;
        const y = row * 31 + 620;
        for (const r of [10, 18, 26]) {
          c.beginPath();
          c.arc(x, y, r, Math.PI, TAU);
          c.stroke();
        }
      }
    }
    c.restore();

    const drift = this.motionReduced ? 0 : Math.sin(now / 9000) * 4;
    this.cloud(-5 + drift, 277, 0.7, 'rgba(194,155,81,.12)');
    this.cloud(368 - drift, 312, 0.9, 'rgba(194,155,81,.1)');
    this.cloud(37, active ? 164 : 225, 0.43, 'rgba(194,155,81,.09)');
    this.cloud(345, 189, 0.5, 'rgba(194,155,81,.09)');
    c.strokeStyle = 'rgba(194,155,81,.21)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(20, 708);
    c.lineTo(125, 708);
    c.moveTo(295, 708);
    c.lineTo(400, 708);
    c.stroke();
    this.diamond(210, 708, 3.5, 'rgba(194,155,81,.65)');
  }

  cloud(x, y, scale, color) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-55, 13);
    c.lineTo(16, 13);
    c.bezierCurveTo(49, 13, 52, -8, 28, -8);
    c.bezierCurveTo(25, -36, -10, -33, -16, -14);
    c.bezierCurveTo(-34, -22, -47, -7, -39, 4);
    c.lineTo(-66, 4);
    c.stroke();
    c.beginPath();
    c.moveTo(-25, 22);
    c.lineTo(53, 22);
    c.stroke();
    c.restore();
  }

  drawHalo(now, active) {
    const c = this.ctx;
    c.save();
    c.translate(210, 458);
    const glow = c.createRadialGradient(0, 0, 37, 0, 0, 169);
    glow.addColorStop(0, 'rgba(221,182,101,.19)');
    glow.addColorStop(0.7, 'rgba(221,182,101,.07)');
    glow.addColorStop(1, 'rgba(221,182,101,0)');
    c.fillStyle = glow;
    c.beginPath(); c.arc(0, 0, 170, 0, TAU); c.fill();
    for (const [r, alpha, width] of [[108, 0.3, 1.2], [114, 0.14, 0.7], [153, 0.15, 0.7]]) {
      c.strokeStyle = `rgba(194,155,81,${alpha})`;
      c.lineWidth = width;
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    }
    c.strokeStyle = 'rgba(194,155,81,.18)';
    c.lineWidth = 0.65;
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * TAU;
      c.beginPath();
      c.moveTo(Math.cos(a) * 119, Math.sin(a) * 119);
      c.lineTo(Math.cos(a) * (i % 3 === 0 ? 145 : 135), Math.sin(a) * (i % 3 === 0 ? 145 : 135));
      c.stroke();
      if (i % 3 === 0) this.diamond(Math.cos(a) * 153, Math.sin(a) * 153, 2, 'rgba(194,155,81,.26)');
    }
    c.restore();
  }

  drawArms(arms, engine, now) {
    const c = this.ctx;
    for (let lane = arms - 1; lane >= 0; lane--) {
      const p = this.getArmPose(lane, engine);
      const { shoulder, elbow, wrist } = p;
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = '#8e743f';
      c.lineWidth = 20;
      c.beginPath();
      c.moveTo(shoulder.x, shoulder.y);
      c.quadraticCurveTo(elbow.x + p.side * 8, elbow.y + 13, elbow.x, elbow.y);
      c.quadraticCurveTo(wrist.x - p.side * 11, wrist.y + 16, wrist.x, wrist.y);
      c.stroke();
      c.strokeStyle = '#dfb964';
      c.lineWidth = 17;
      c.stroke();
      c.strokeStyle = 'rgba(255,242,179,.68)';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(shoulder.x - p.side * 3, shoulder.y - 4);
      c.quadraticCurveTo(elbow.x + p.side * 5, elbow.y + 5, elbow.x - p.side * 1.5, elbow.y - 1);
      c.stroke();
      c.strokeStyle = '#b58a3e';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(p.x - 8, p.y + 22);
      c.lineTo(p.x + 8, p.y + 22);
      c.moveTo(p.x - 7, p.y + 27);
      c.lineTo(p.x + 7, p.y + 27);
      c.stroke();

      this.drawHand(p.x, p.y, p.side, p.rotation);
      c.restore();
    }
  }

  drawCatchRings(engine, arms) {
    if (engine.phase !== 'playing' && engine.phase !== 'paused') return;
    const c = this.ctx;
    const time = engine.time || 0;
    // A lane may be in several queued groups. Show its nearest uncaught arrival.
    const nextDue = new Map();
    for (const event of engine.events || []) {
      const remain = event.due - time;
      if (remain < -HIT_WINDOW || remain > 1200) continue;
      for (let index = 0; index < (event.lanes?.length || 0); index++) {
        if (event.caught?.[index]) continue;
        const lane = event.lanes[index];
        if (!nextDue.has(lane) || remain < nextDue.get(lane)) nextDue.set(lane, remain);
      }
    }
    for (const [lane, remain] of nextDue) {
      const p = this.getArmPose(lane, engine);
      const radius = 14 + 28 * clamp(remain / 1200);
      const ready = Math.abs(remain) <= HIT_WINDOW;
      c.save();
      c.lineWidth = ready ? 2.7 : 1.8;
      c.strokeStyle = ready ? VERMILION : `rgba(164,123,46,${0.38 + 0.48 * (1 - clamp(remain / 1200))})`;
      c.fillStyle = ready ? 'rgba(221,182,101,.13)' : 'rgba(221,182,101,.035)';
      c.beginPath();
      c.arc(p.x, p.y - 9, radius, 0, TAU);
      c.fill(); c.stroke();
      if (ready) {
        c.strokeStyle = '#f1d389';
        c.lineWidth = 0.9;
        c.beginPath(); c.arc(p.x, p.y - 9, radius + 3, 0, TAU); c.stroke();
      }
      c.restore();
    }
  }

  drawHand(x, y, side, rotation = 0) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    c.scale(side, 1);
    c.fillStyle = '#f4ce9d';
    c.strokeStyle = '#b38750';
    c.lineWidth = 1.15;
    c.beginPath();
    c.moveTo(-5, 16);
    c.quadraticCurveTo(-9, 11, -13, 6);
    c.quadraticCurveTo(-18, 1, -15, -2);
    c.quadraticCurveTo(-12, -4, -7, 2);
    c.lineTo(-6, -9);
    c.quadraticCurveTo(-5, -14, -2, -10);
    c.lineTo(0, -3);
    c.lineTo(1, -12);
    c.quadraticCurveTo(3, -16, 5, -11);
    c.lineTo(6, -3);
    c.lineTo(8, -9);
    c.quadraticCurveTo(11, -13, 12, -8);
    c.lineTo(11, 5);
    c.quadraticCurveTo(11, 12, 6, 16);
    c.closePath();
    c.fill(); c.stroke();
    c.strokeStyle = 'rgba(159,112,61,.42)';
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(-5, 5); c.quadraticCurveTo(0, 2, 5, 5);
    c.moveTo(-2, 9); c.quadraticCurveTo(1, 7, 4, 9);
    c.stroke();
    c.restore();
  }

  drawLotus(now) {
    const c = this.ctx;
    c.save();
    c.translate(210, 623);
    const shadow = c.createRadialGradient(0, 24, 8, 0, 24, 125);
    shadow.addColorStop(0, 'rgba(84,82,49,.14)');
    shadow.addColorStop(1, 'rgba(84,82,49,0)');
    c.fillStyle = shadow;
    c.beginPath(); c.ellipse(0, 22, 131, 24, 0, 0, TAU); c.fill();
    // Alternating layers give the lotus a clear silhouette at small sizes.
    for (const layer of [0, 1]) {
      for (let i = -3; i <= 3; i++) {
        c.save();
        c.translate(i * (layer ? 22 : 26), layer ? 13 : 1);
        c.rotate(i * (layer ? 0.29 : 0.25));
        c.fillStyle = layer ? (i % 2 ? '#aabbb0' : '#d0d7bd') : (i % 2 ? '#e3bd79' : '#edcf95');
        c.strokeStyle = layer ? '#54776b' : '#c19b53';
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(0, 18);
        c.bezierCurveTo(-28, 11, -35, -12, 0, -37);
        c.bezierCurveTo(35, -12, 28, 11, 0, 18);
        c.fill(); c.stroke();
        c.strokeStyle = layer ? 'rgba(71,106,92,.24)' : 'rgba(160,119,51,.28)';
        c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(0, 14); c.quadraticCurveTo(-3, -7, 0, -27); c.stroke();
        c.restore();
      }
    }
    c.fillStyle = '#315c50';
    c.beginPath(); c.ellipse(0, 26, 66, 9, 0, 0, TAU); c.fill();
    c.strokeStyle = '#c4a269'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, 24, 64, 7, 0, 0, Math.PI); c.stroke();
    c.restore();
  }

  drawBody() {
    const c = this.ctx;
    c.save();
    c.lineJoin = 'round';
    c.fillStyle = '#d4ab5c';
    c.strokeStyle = '#99763c';
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(183, 489);
    c.quadraticCurveTo(168, 492, 163, 519);
    c.lineTo(155, 567);
    c.quadraticCurveTo(133, 573, 124, 589);
    c.bezierCurveTo(106, 618, 147, 624, 210, 623);
    c.bezierCurveTo(273, 624, 314, 618, 296, 589);
    c.quadraticCurveTo(287, 573, 265, 567);
    c.lineTo(257, 519);
    c.quadraticCurveTo(252, 492, 237, 489);
    c.closePath(); c.fill(); c.stroke();

    c.fillStyle = '#edcc7c';
    c.beginPath();
    c.moveTo(184, 495);
    c.quadraticCurveTo(196, 521, 210, 528);
    c.quadraticCurveTo(224, 521, 236, 495);
    c.lineTo(244, 542);
    c.quadraticCurveTo(224, 562, 235, 600);
    c.quadraticCurveTo(206, 617, 174, 606);
    c.quadraticCurveTo(192, 571, 173, 546);
    c.closePath(); c.fill();

    c.fillStyle = INK;
    c.strokeStyle = '#163d38';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(177, 497);
    c.bezierCurveTo(178, 533, 190, 553, 194, 579);
    c.quadraticCurveTo(178, 588, 152, 594);
    c.quadraticCurveTo(175, 601, 206, 600);
    c.bezierCurveTo(214, 565, 188, 537, 188, 505);
    c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = '#c9ae6f';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(183, 506); c.bezierCurveTo(185, 540, 208, 569, 200, 595); c.stroke();
    c.strokeStyle = 'rgba(145,106,45,.55)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(239, 542); c.quadraticCurveTo(224, 575, 250, 604);
    c.moveTo(259, 574); c.quadraticCurveTo(235, 582, 249, 601);
    c.moveTo(157, 575); c.quadraticCurveTo(170, 580, 164, 591);
    c.moveTo(131, 605); c.quadraticCurveTo(166, 620, 201, 614);
    c.moveTo(221, 615); c.quadraticCurveTo(262, 620, 290, 605);
    c.stroke();

    // The two front hands rest in a relaxed, symmetrical mudra.
    c.fillStyle = '#f4ce9d';
    c.strokeStyle = '#b38750';
    c.lineWidth = 1.1;
    for (const side of [-1, 1]) {
      c.save();
      c.translate(210, 561); c.scale(side, 1);
      c.beginPath();
      c.moveTo(12, 4); c.quadraticCurveTo(32, 6, 42, -4);
      c.quadraticCurveTo(48, -8, 46, -12);
      c.quadraticCurveTo(42, -15, 37, -9);
      c.quadraticCurveTo(23, -5, 8, -6);
      c.quadraticCurveTo(-1, -8, -3, -3);
      c.quadraticCurveTo(-3, 2, 12, 4);
      c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
    c.restore();
  }

  drawNecklace() {
    const c = this.ctx;
    c.strokeStyle = '#aa7936'; c.lineWidth = 1.7;
    c.beginPath(); c.moveTo(188, 495); c.quadraticCurveTo(210, 541, 232, 495); c.stroke();
    for (let i = 0; i < 9; i++) {
      const a = i / 8 * Math.PI;
      const x = 210 - 21 * Math.cos(a);
      const y = 498 + Math.sin(a) * 27;
      c.fillStyle = i === 4 ? VERMILION : '#f6dda0';
      c.strokeStyle = '#ad823c'; c.lineWidth = 0.8;
      c.beginPath(); c.arc(x, y, i === 4 ? 3.5 : 2.1, 0, TAU); c.fill(); c.stroke();
    }
  }

  drawHead(balls, now) {
    const c = this.ctx;
    c.save();
    c.fillStyle = '#f4ce9d';
    c.strokeStyle = '#ac854d'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(197, 475); c.lineTo(195, 500); c.quadraticCurveTo(210, 515, 225, 500); c.lineTo(223, 475); c.closePath(); c.fill(); c.stroke();

    c.fillStyle = '#29443e';
    c.beginPath(); c.ellipse(210, 443, 39, 46, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(210, 404, 18, 19, 0, 0, TAU); c.fill();
    c.strokeStyle = '#153b35'; c.lineWidth = 1;
    c.beginPath(); c.ellipse(210, 404, 12, 13, 0, Math.PI, TAU); c.stroke();

    for (const side of [-1, 1]) {
      c.fillStyle = '#f4ce9d'; c.strokeStyle = '#b38750'; c.lineWidth = 1;
      c.beginPath(); c.ellipse(210 + side * 33, 461, 6, 12, side * 0.1, 0, TAU); c.fill(); c.stroke();
      c.strokeStyle = '#b88b3d'; c.lineWidth = 2.5;
      c.beginPath(); c.ellipse(210 + side * 35, 479, 4.4, 7, 0, 0, TAU); c.stroke();
    }
    c.fillStyle = '#f6d3a6'; c.strokeStyle = '#b18b53'; c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(179, 436);
    c.bezierCurveTo(176, 458, 181, 486, 210, 492);
    c.bezierCurveTo(239, 486, 244, 458, 241, 436);
    c.quadraticCurveTo(221, 440, 210, 425);
    c.quadraticCurveTo(197, 440, 179, 436);
    c.closePath(); c.fill(); c.stroke();

    c.fillStyle = 'rgba(204,113,79,.24)';
    c.beginPath(); c.ellipse(188, 470, 7, 3, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(232, 470, 7, 3, 0, 0, TAU); c.fill();

    this.drawCrown();
    c.strokeStyle = INK;
    c.lineWidth = 1.8;
    c.lineCap = 'round';
    const tense = balls >= 4;
    c.beginPath();
    if (!tense) {
      c.moveTo(188, 451); c.quadraticCurveTo(194, 448, 199, 451);
      c.moveTo(221, 451); c.quadraticCurveTo(227, 448, 232, 451);
    } else {
      c.moveTo(188, 448); c.quadraticCurveTo(195, 445, 200, 449);
      c.moveTo(220, 449); c.quadraticCurveTo(225, 445, 232, 448);
    }
    c.stroke();
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(188, 459); c.quadraticCurveTo(194, tense ? 455 : 463, 200, 459);
    c.moveTo(220, 459); c.quadraticCurveTo(226, tense ? 455 : 463, 232, 459);
    c.stroke();
    c.strokeStyle = '#b58753'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(210, 460); c.quadraticCurveTo(207, 469, 212, 468); c.stroke();
    c.strokeStyle = '#a35c44'; c.lineWidth = 1.6;
    c.beginPath();
    if (balls >= 12) {
      c.ellipse(210, 478, 3.5, 4, 0, 0, TAU);
    } else {
      c.moveTo(204, 478); c.quadraticCurveTo(210, tense ? 480 : 483, 216, 478);
    }
    c.stroke();
    this.diamond(210, 447, 2, VERMILION);

    if (balls >= 7) this.drop(245, 449, balls >= 12 ? 6 : 4.4, '#8cb5b2');
    if (balls >= 12) {
      this.drop(174, 456, 5, '#8cb5b2');
      this.drop(251, 467, 3.3, '#8cb5b2');
      c.strokeStyle = 'rgba(189,77,53,.5)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(251, 430); c.lineTo(256, 424); c.moveTo(257, 438); c.lineTo(264, 435); c.stroke();
    }
    c.restore();
  }

  drawCrown() {
    const c = this.ctx;
    c.fillStyle = '#d8b365'; c.strokeStyle = '#a27b36'; c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(179, 434); c.lineTo(179, 412); c.lineTo(191, 419);
    c.lineTo(197, 400); c.lineTo(205, 412); c.lineTo(210, 387);
    c.lineTo(215, 412); c.lineTo(223, 400); c.lineTo(229, 419);
    c.lineTo(241, 412); c.lineTo(241, 434);
    c.quadraticCurveTo(210, 443, 179, 434);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#f5d991';
    c.beginPath(); c.moveTo(183, 430); c.quadraticCurveTo(210, 438, 237, 430); c.lineTo(237, 435); c.quadraticCurveTo(210, 442, 183, 435); c.closePath(); c.fill();
    c.strokeStyle = '#aa7e37'; c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(185, 422); c.quadraticCurveTo(210, 430, 235, 422); c.stroke();
    c.fillStyle = VERMILION; c.strokeStyle = '#9e7139'; c.lineWidth = 1;
    c.beginPath(); c.ellipse(210, 418, 5.2, 7, 0, 0, TAU); c.fill(); c.stroke();
    for (const side of [-1, 1]) {
      this.diamond(210 + side * 18, 423, 2.1, '#f9e9b7');
      c.fillStyle = '#e5c478'; c.beginPath(); c.arc(210 + side * 30, 411, 2.5, 0, TAU); c.fill();
    }
  }

  drawBalls(engine, now, active, arms) {
    const c = this.ctx;
    if (!active) {
      const demo = this.getDemoEngine(now);
      for (const event of demo.events) {
        const ball = this.getBallPosition(event, 0, demo.time, demo);
        this.drawBall(ball.x, ball.y, 12, ball.variant, ball.fraction * ball.side * 2);
      }
      return;
    }
    const time = engine.time || 0;
    const balls = [];
    for (const event of engine.events || []) {
      const remain = event.due - time;
      if (remain < -HIT_WINDOW - 1) continue;
      for (let i = 0; i < (event.lanes?.length || 0); i++) {
        // The engine creates this same ball's returning flight on its catch.
        if (event.caught?.[i]) continue;
        balls.push(this.getBallPosition(event, i, time, engine));
      }
    }
    balls.sort((a, b) => a.y - b.y);
    for (const ball of balls) {
      c.save();
      if (ball.overdue) c.globalAlpha = 1 - ball.overdue * 0.5;
      this.drawBall(ball.x, ball.y, 11.7, ball.variant, ball.fraction * ball.side * 2);
      c.restore();
    }
  }

  getBallPosition(event, index, time, engine = { events: [event] }) {
    const lane = event.lanes[index];
    const target = this.getLanePosition(lane);
    const from = event.fromLanes?.[index] ?? (lane ^ 1);
    const launch = event.launchTimes?.[index] ?? event.created ?? event.due - INITIAL_FLIGHT;
    const variant = (event.ballIds?.[index] ?? lane + 1) - 1;
    if (time < launch) {
      const held = this.getArmPose(from, engine, time);
      return { x: held.x, y: held.y - 10, fraction: 0, overdue: 0, side: target.side, variant };
    }
    // Capture release contact once. Subsequent catches and arm growth must not
    // pull a ball that has already left the hand away from its fixed parabola.
    this.flightOrigins ||= new WeakMap();
    let origins = this.flightOrigins.get(event);
    if (!origins) { origins = []; this.flightOrigins.set(event, origins); }
    const source = origins[index] ||= this.getArmPose(from, engine, launch);
    const flight = Math.max(1, event.due - launch);
    const fraction = clamp((time - launch) / flight);
    const overdue = clamp((time - event.due) / HIT_WINDOW);
    // Stagger the two arcs vertically so opposing balls pass each other visibly.
    const height = 135 + Math.abs(target.x - source.x) * 0.17 + (variant % 2) * 44;
    return {
      x: source.x + (target.x - source.x) * fraction,
      y: source.y + (target.y - source.y) * fraction - 10
        - 4 * fraction * (1 - fraction) * height + overdue * 38,
      fraction, overdue, side: target.side,
      variant,
    };
  }

  drawBall(x, y, r, variant, rotation) {
    const c = this.ctx;
    const palettes = [
      ['#bd4d35', '#efca83', '#8f3d30'],
      ['#315e54', '#ecd39a', '#22483f'],
      ['#cf9b49', '#f1dfb3', '#a57834'],
      ['#857088', '#e6ccb7', '#655169'],
    ];
    const [base, patch, edge] = palettes[variant % palettes.length];
    c.save(); c.translate(x, y); c.rotate(rotation);
    c.fillStyle = 'rgba(92,75,46,.1)';
    c.beginPath(); c.ellipse(1, r - 1, r * 0.8, 3, 0, 0, TAU); c.fill();
    c.fillStyle = base; c.strokeStyle = edge; c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(0, -r);
    c.bezierCurveTo(r * 0.73, -r, r * 1.04, -r * 0.2, r * 0.95, r * 0.28);
    c.bezierCurveTo(r * 0.83, r * 0.94, r * 0.24, r * 1.1, -r * 0.29, r * 0.97);
    c.bezierCurveTo(-r * 1.04, r * 0.86, -r * 1.12, r * 0.1, -r * 0.92, -r * 0.39);
    c.bezierCurveTo(-r * 0.72, -r * 0.86, -r * 0.35, -r, 0, -r);
    c.closePath(); c.fill(); c.stroke();
    c.save(); c.clip();
    c.fillStyle = patch;
    c.beginPath(); c.moveTo(-r, -r * 0.12); c.quadraticCurveTo(-1, -r * 0.58, r, r * 0.14); c.lineTo(r, r * 0.74); c.quadraticCurveTo(0, r * 0.24, -r, r * 0.66); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,242,209,.73)'; c.lineWidth = 0.65;
    for (let i = -3; i <= 3; i++) {
      c.beginPath(); c.moveTo(i * 3.8, -r); c.lineTo(i * 3.8 + 2.8, r); c.stroke();
    }
    c.strokeStyle = edge; c.lineWidth = 0.65; c.setLineDash([1.6, 2]);
    c.beginPath(); c.moveTo(-r, -r * 0.16); c.quadraticCurveTo(-1, -r * 0.62, r, r * 0.09); c.stroke();
    c.beginPath(); c.moveTo(-r, r * 0.61); c.quadraticCurveTo(0, r * 0.19, r, r * 0.7); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,252,231,.27)'; c.beginPath(); c.ellipse(-3, -6, 4, 2, -0.5, 0, TAU); c.fill();
    c.restore();
    c.restore();
  }

  drawEffects(now) {
    const c = this.ctx;
    this.effects = this.effects.filter(effect => now - effect.start < 650);
    for (const effect of this.effects) {
      const t = (now - effect.start) / 650;
      c.save();
      c.globalAlpha = (1 - t) * 0.9;
      c.strokeStyle = effect.success ? GOLD : VERMILION;
      c.lineWidth = 1.8 * (1 - t) + 0.3;
      c.beginPath(); c.ellipse(effect.x, effect.y, 10 + t * 30, 5 + t * 15, 0, 0, TAU); c.stroke();
      if (!this.motionReduced) {
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * TAU - Math.PI / 2;
          const distance = 10 + t * 31;
          this.diamond(effect.x + Math.cos(a) * distance, effect.y + Math.sin(a) * distance, (1 - t) * 2.7, effect.success ? '#c29b51' : VERMILION);
        }
      }
      c.restore();
    }
  }

  drawForeground() {
    const c = this.ctx;
    // Two tiny botanical motifs frame, without occupying the playable center.
    for (const side of [-1, 1]) {
      c.save(); c.translate(side === -1 ? 24 : 396, 666); c.scale(side === -1 ? 1 : -1, 1);
      c.strokeStyle = 'rgba(50,91,76,.3)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, 4); c.quadraticCurveTo(5, -10, 17, -18); c.stroke();
      c.fillStyle = 'rgba(61,106,83,.19)';
      c.beginPath(); c.ellipse(9, -11, 7, 3, -0.6, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(3, -5, 6, 2.5, 0.3, 0, TAU); c.fill();
      c.restore();
    }
  }

  diamond(x, y, radius, color) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath(); c.moveTo(x, y - radius); c.lineTo(x + radius * 0.65, y); c.lineTo(x, y + radius); c.lineTo(x - radius * 0.65, y); c.closePath(); c.fill();
  }

  drop(x, y, r, color) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath(); c.moveTo(x, y - r * 1.6); c.bezierCurveTo(x + r, y - r * 0.2, x + r, y + r, x, y + r); c.bezierCurveTo(x - r, y + r, x - r, y - r * 0.2, x, y - r * 1.6); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - r * 0.2, y - r * 0.3); c.lineTo(x - r * 0.32, y + r * 0.3); c.stroke();
  }
}
