import { GameEngine, getTitle, CATCHES_PER_LEVEL } from './game.js?v=3';
import { GameRenderer } from './renderer.js?v=3';

const $ = id => document.getElementById(id);
const shell = $('game');
const scene = $('scene');
const renderer = new GameRenderer(scene);
const STORAGE_KEY = 'senju-otedama.best.v1';
let best = 0;
try { best = Math.max(0, Math.min(9999, Number(localStorage.getItem(STORAGE_KEY)) || 0)); } catch { /* Private browsing can disable storage. */ }
let previousBest = best;
let lastTick = performance.now();
let feedbackUntil = 0;
let feedbackPriorityUntil = 0;
let toastTimer;
let resultTimer;
let modalReturnFocus;

const engine = new GameEngine({ onEvent: handleGameEvent });

function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}

function feedback(text, detail = '', duration = 750, priority = false) {
  const now = performance.now();
  if (!priority && now < feedbackPriorityUntil) return;
  $('feedback').replaceChildren(document.createTextNode(text));
  if (detail) { const small = document.createElement('small'); small.textContent = detail; $('feedback').append(small); }
  $('feedback').classList.add('visible');
  feedbackUntil = now + duration;
  if (priority) feedbackPriorityUntil = feedbackUntil;
}

function updateBestLabels() {
  $('menu-best').textContent = best || '—';
  $('best').textContent = best || '—';
}

function handleGameEvent(event) {
  if (event.type === 'catch') {
    renderer.burst(event.lanes, true);
    feedback(event.count > 1 ? `${event.count}本指、おみごと。` : event.accuracy > .68 ? 'ぴたり。' : 'よい調子。', `${engine.combo} 回つづいています`, 600);
  } else if (event.type === 'level') {
    feedback(`${event.balls}個へ。`, getTitle(event.balls), 1400, true);
  } else if (event.type === 'empty') {
    feedback('ゆっくりで、大丈夫。', '手に届くタイミングでタップ', 650);
  } else if (event.type === 'miss') {
    renderer.burst(event.lanes, false);
    feedback('あっ。', 'ひとつ、こぼれました。', 700, true);
    clearTimeout(resultTimer);
    resultTimer = setTimeout(showResult, 650);
  }
  updateHud();
}

function updateHud() {
  $('balls').textContent = engine.balls;
  $('progress').style.width = `${(engine.catches % CATCHES_PER_LEVEL) / CATCHES_PER_LEVEL * 100}%`;
  $('level-label').textContent = `あと${CATCHES_PER_LEVEL - engine.catches % CATCHES_PER_LEVEL}回で、玉がひとつ増えます`;
  $('combo').textContent = engine.catches ? `投げ返した数 ${engine.catches} 回` : 'どこをタップしても大丈夫';
  const next = engine.events.find(event => event.caught.some(value => !value));
  const remain = next ? next.due - engine.time : Infinity;
  const fingers = remain < 2000 ? next.lanes.length : 1;
  $('fingers').lastElementChild.textContent = fingers > 1 ?
    `${fingers}本の指で、同時にタップ` : '玉が手に届くタイミングでタップ';
  $('fingers').classList.toggle('multi', fingers > 1);
}

function startGame() {
  clearTimeout(resultTimer);
  previousBest = best;
  feedbackPriorityUntil = 0;
  $('menu').hidden = true;
  $('result').hidden = true;
  $('rules').hidden = true;
  $('paused').hidden = true;
  $('hud').hidden = false;
  $('toast').hidden = true;
  renderer.setResultFace?.(2);
  engine.start();
  lastTick = performance.now();
  feedback('ゆっくり、輪を見て。', '手に届くタイミングでタップ', 1300, true);
  updateHud();
  shell.focus({ preventScroll: true });
}

function goHome() {
  clearTimeout(resultTimer);
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  engine.reset();
  renderer.setResultFace?.(2);
  $('hud').hidden = true;
  $('result').hidden = true;
  $('paused').hidden = true;
  $('menu').hidden = false;
  $('start').focus({ preventScroll: true });
  updateBestLabels();
}

function pauseGame() {
  if (engine.phase !== 'playing') return;
  syncClock();
  if (engine.phase !== 'playing') return;
  engine.pause();
  $('paused').hidden = false;
  $('resume').focus({ preventScroll: true });
}

function resumeGame() {
  $('paused').hidden = true;
  engine.resume();
  lastTick = performance.now();
  shell.focus({ preventScroll: true });
}

function showResult() {
  if (engine.phase !== 'over') return;
  const isRecord = engine.balls > previousBest;
  best = Math.max(best, engine.balls);
  try { localStorage.setItem(STORAGE_KEY, String(best)); } catch { showToast('このブラウザでは最高記録を保存できません。'); }
  $('result-balls').textContent = engine.balls;
  $('result-title').textContent = getTitle(engine.balls);
  $('result-catches').replaceChildren(document.createTextNode(String(engine.catches)), Object.assign(document.createElement('span'), { textContent: '回' }));
  $('result-best').replaceChildren(document.createTextNode(String(best)), Object.assign(document.createElement('span'), { textContent: '個' }));
  $('new-record').hidden = !isRecord;
  $('hud').hidden = true;
  $('result').hidden = false;
  const shareUrl = new URL('https://twitter.com/intent/tweet');
  shareUrl.searchParams.set('text', `千手お手玉で${engine.balls}個まで到達！ ${getTitle(engine.balls)}。あなたは何個いける？`);
  shareUrl.searchParams.set('url', location.href.split(/[?#]/)[0]);
  shareUrl.searchParams.set('hashtags', '千手お手玉');
  $('share').href = shareUrl.href;
  updateBestLabels();
  $('retry').focus({ preventScroll: true });
}

function syncClock(now = performance.now()) {
  // Pointer events can run before an RAF callback carrying an older timestamp.
  // Never rewind the clock and count that interval a second time.
  if (now <= lastTick) return;
  engine.update(now - lastTick);
  lastTick = now;
}

function frame(now) {
  syncClock(now);
  renderer.draw(engine, now);
  if (engine.phase === 'playing') updateHud();
  if (now > feedbackUntil) $('feedback').classList.remove('visible');
  requestAnimationFrame(frame);
}

shell.tabIndex = -1;
shell.addEventListener('pointerdown', event => {
  if (event.target.closest('button, a, .modal-card, .result-card') || engine.phase !== 'playing') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  syncClock();
  engine.tap(1);
});
shell.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && engine.phase === 'playing') {
    event.preventDefault();
    if (!event.repeat) { syncClock(); engine.tap(1); }
  } else if (event.code === 'Escape') {
    if (!$('rules').hidden) closeRules();
    else if (engine.phase === 'playing') pauseGame();
    else if (engine.phase === 'paused') resumeGame();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('blur', pauseGame);
window.addEventListener('resize', () => renderer.resize());
new ResizeObserver(() => renderer.resize()).observe(shell);

function openRules() { modalReturnFocus = document.activeElement; $('rules').hidden = false; $('close-rules').focus({ preventScroll: true }); }
function closeRules() { $('rules').hidden = true; modalReturnFocus?.focus({ preventScroll: true }); }
$('start').addEventListener('click', startGame);
$('retry').addEventListener('click', startGame);
$('how').addEventListener('click', openRules);
$('close-rules').addEventListener('click', closeRules);
$('pause').addEventListener('click', pauseGame);
$('resume').addEventListener('click', resumeGame);
$('quit').addEventListener('click', goHome);
$('home').addEventListener('click', goHome);
$('save').addEventListener('click', saveCard);

// Modal keyboard navigation stays within the currently open dialog.
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const modal = !$('rules').hidden ? $('rules') : !$('paused').hidden ? $('paused') : null;
  if (!modal) return;
  const focusable = [...modal.querySelectorAll('button, a[href]')];
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

async function saveCard() {
  const button = $('save');
  button.disabled = true;
  try {
    const card = document.createElement('canvas');
    card.width = 900; card.height = 1200;
    const ctx = card.getContext('2d');
    ctx.fillStyle = '#f6efdf'; ctx.fillRect(0, 0, 900, 1200);
    ctx.strokeStyle = '#b79350'; ctx.lineWidth = 2; ctx.strokeRect(30, 30, 840, 1140);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b79350'; ctx.font = '18px sans-serif'; ctx.fillText('S E N J U   O T E D A M A', 450, 100);
    ctx.fillStyle = '#244f48'; ctx.font = 'bold 57px "Yu Mincho", serif'; ctx.fillText('千手お手玉', 450, 182);
    ctx.fillStyle = '#b94b35'; ctx.font = '150px Georgia, serif';
    const numberWidth = ctx.measureText(String(engine.balls)).width;
    ctx.font = '26px "Yu Mincho", serif';
    const labelWidth = ctx.measureText('個まで到達').width;
    const scoreLeft = (900 - numberWidth - labelWidth - 20) / 2;
    ctx.font = '150px Georgia, serif'; ctx.fillText(String(engine.balls), scoreLeft + numberWidth / 2, 355);
    ctx.font = '26px "Yu Mincho", serif'; ctx.fillText('個まで到達', scoreLeft + numberWidth + 20 + labelWidth / 2, 346);
    ctx.fillStyle = '#244f48'; ctx.font = '34px "Yu Mincho", serif'; ctx.fillText(getTitle(engine.balls), 450, 425);
    renderer.draw(engine, performance.now());
    const sx = scene.width / 420, sy = scene.height / 760;
    ctx.drawImage(scene, 0, 240 * sy, 420 * sx, 430 * sy, 130, 460, 640, 655);
    ctx.fillStyle = '#f6efdf'; ctx.fillRect(80, 1035, 740, 104);
    ctx.fillStyle = '#244f48'; ctx.font = '23px sans-serif'; ctx.fillText(`投げ返した数 ${engine.catches}回   ／   最高記録 ${best}個`, 450, 1070);
    ctx.fillStyle = '#b94b35'; ctx.font = '25px "Yu Mincho", serif'; ctx.fillText('あなたは何個いける？  #千手お手玉', 450, 1120);
    const blob = await new Promise(resolve => card.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG generation failed');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `千手お手玉_${engine.balls}個.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast('結果のPNGを用意しました。保存した画像をXに添付できます。');
  } catch { showToast('画像を保存できませんでした。もう一度お試しください。'); }
  finally { button.disabled = false; }
}

// Opt-in local diagnostics for reproducible playtests. Normal URLs expose no state.
if (new URLSearchParams(location.search).has('debug') && ['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__senju = { engine, renderer, startGame, showResult, saveCard };
}
updateBestLabels();
renderer.resize();
requestAnimationFrame(frame);
