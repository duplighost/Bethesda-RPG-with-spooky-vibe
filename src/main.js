// ============================================================
// main.js — HALLOWIND bootstrap. Renderer, input, the diegetic
// coffin-wakeup intro, the game loop, and all HUD wiring.
// ============================================================
import * as THREE from 'three';
import { World, REGIONS } from './world.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Items } from './items.js';
import { Quests } from './quests.js';
import { Audio } from './audio.js';
import { clamp, dist2D, TAU } from './utils.js';

// ---------- Renderer / Scene / Camera ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1600);
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Systems ----------
const audio = new Audio();
const world = new World(scene, 1031).build();
const player = new Player(camera, world, audio);
const quests = new Quests(world, player, audio);
const enemies = new Enemies(scene, world, player, audio);
const weapons = new Weapons(camera, scene, player, enemies, audio);
const items = new Items(scene, world, player, audio, quests);
player.weaponsRef = weapons;
enemies.onBossDefeated = () => quests.onBossDefeated();

document.getElementById('loading').classList.add('hidden');

// ---------- Input ----------
const input = { fwd: false, back: false, left: false, right: false, sprint: false, jump: false };
let started = false, paused = false, mapOpen = false;

const keyMap = {
  KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
};

addEventListener('keydown', (e) => {
  if (!started) return;
  if (keyMap[e.code] !== undefined) { input[keyMap[e.code]] = true; }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = true;
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }

  if (items.reading) {
    if (e.code === 'KeyE' || e.code === 'Escape') items.closeReader();
    return;
  }

  switch (e.code) {
    case 'KeyF': player.toggleLantern(); break;
    case 'KeyQ': weapons.flare(); break;
    case 'KeyR': weapons.reload(); break;
    case 'Digit1': weapons.setMode('gun'); break;
    case 'Digit2': weapons.setMode('spell'); break;
    case 'KeyE': items.interact(items.nearest()); break;
    case 'Tab': e.preventDefault(); toggleMap(); break;
  }
});
addEventListener('keyup', (e) => {
  if (keyMap[e.code] !== undefined) input[keyMap[e.code]] = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false;
  if (e.code === 'Space') input.jump = false;
});

// Mouse
addEventListener('mousemove', (e) => {
  if (!started || paused || mapOpen || items.reading) return;
  if (document.pointerLockElement === canvas) {
    player.addLook(e.movementX, e.movementY);
  }
});
let lmb = false, rmb = false;
canvas.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (document.pointerLockElement !== canvas && !items.reading && !mapOpen) { canvas.requestPointerLock(); return; }
  if (e.button === 0) { lmb = true; weapons.primary(); }
  if (e.button === 2) { rmb = true; weapons.secondary(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; });
addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  paused = document.pointerLockElement !== canvas;
});

// ---------- Map ----------
const mapCanvas = document.getElementById('map-canvas');
const mctx = mapCanvas.getContext('2d');
function toggleMap() {
  mapOpen = !mapOpen;
  document.getElementById('map').classList.toggle('hidden', !mapOpen);
  if (mapOpen && document.pointerLockElement) document.exitPointerLock();
  else if (!mapOpen) canvas.requestPointerLock();
}
function drawMap() {
  const W = mapCanvas.width, H = mapCanvas.height, scale = W / (world.WORLD * 2);
  mctx.fillStyle = '#0b0d12'; mctx.fillRect(0, 0, W, H);
  const toX = (x) => W / 2 + x * scale, toY = (z) => H / 2 + z * scale;
  // regions
  for (const r of REGIONS) {
    mctx.beginPath();
    mctx.arc(toX(r.x), toY(r.z), r.r * scale, 0, TAU);
    mctx.fillStyle = 'rgba(255,122,24,0.06)';
    mctx.fill();
    mctx.strokeStyle = 'rgba(255,122,24,0.4)'; mctx.lineWidth = 1; mctx.stroke();
    mctx.fillStyle = '#9fb3c8'; mctx.font = '11px Georgia'; mctx.textAlign = 'center';
    mctx.fillText(r.name, toX(r.x), toY(r.z));
  }
  // objective marker
  const tgt = quests.objectiveTarget();
  if (tgt) {
    mctx.beginPath(); mctx.arc(toX(tgt.x), toY(tgt.z), 6, 0, TAU);
    mctx.fillStyle = '#8dff6a'; mctx.fill();
  }
  // player
  mctx.save();
  mctx.translate(toX(player.pos.x), toY(player.pos.z));
  mctx.rotate(-player.yaw);
  mctx.fillStyle = '#ff7a18'; mctx.beginPath();
  mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(-5, 6); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// ---------- Compass ----------
const compassNeedle = document.getElementById('compass-needle');
function updateCompass() {
  const marks = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];
  // build heading string positioned by yaw; plus objective marker ◈
  let html = '';
  const center = 120; // px
  const span = 240 / Math.PI; // px per radian within ~half view
  function rel(angle) {
    let d = angle - player.yaw;
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    return d;
  }
  const items2 = marks.map(([l, a]) => ({ l, x: center + rel(a) * span }));
  const tgt = quests.objectiveTarget();
  if (tgt) {
    const ang = Math.atan2(tgt.x - player.pos.x, tgt.z - player.pos.z);
    items2.push({ l: '◈', x: center + rel(ang) * span });
  }
  // render via positioned spans
  compassNeedle.innerHTML = items2
    .filter(m => m.x > -10 && m.x < 250)
    .map(m => `<span style="position:absolute;left:${m.x}px;transform:translateX(-50%);${m.l==='◈'?'color:#8dff6a':''}">${m.l}</span>`)
    .join('');
  compassNeedle.style.position = 'relative';
  compassNeedle.style.height = '20px';
  compassNeedle.style.display = 'block';
}

// ---------- HUD ----------
let clockMin = 11 * 60 + 54; // 11:54 PM
function updateHUD(dt) {
  document.getElementById('health-fill').style.width = `${clamp(player.hp / player.maxHP, 0, 1) * 100}%`;
  document.getElementById('wisp-fill').style.width = `${clamp(player.wisp / player.maxWisp, 0, 1) * 100}%`;
  document.getElementById('dread-fill').style.width = `${player.dread}%`;

  const reg = world.regionAt(player.pos.x, player.pos.z);
  const rn = document.getElementById('region-name');
  if (rn.textContent !== reg.name) {
    rn.textContent = reg.name;
    audio.setRegionWind(reg.wind);
    scene.fog.color.setHex(reg.fog);
  }
  audio.setDread(player.dread01());

  // clock crawls toward midnight but Hallow's Eve never quite arrives
  clockMin += dt * 0.2;
  let hr = Math.floor(clockMin / 60) % 24, mn = Math.floor(clockMin % 60);
  const ampm = hr >= 12 ? 'PM' : 'AM'; let h12 = hr % 12; if (h12 === 0) h12 = 12;
  document.getElementById('clock').textContent =
    `${h12}:${String(mn).padStart(2, '0')} ${ampm} · Hallow's Eve`;

  // interaction prompt
  const near = items.nearest();
  const prompt = document.getElementById('prompt');
  if (near) {
    prompt.classList.add('show');
    document.getElementById('prompt-text').textContent =
      near.kind === 'note' ? `read · ${near.data.title}` : `take · ${near.data.title}`;
  } else prompt.classList.remove('show');

  updateCompass();
}

// ---------- Intro sequence ----------
const introLinesEl = document.getElementById('intro-lines');
const INTRO = [
  'Dirt hitting wood.',
  'Someone, very close, is crying.',
  'A preacher recites the wrong words.',
  'A match strikes.',
  'A small voice: “He’s still breathing.”',
  '',
  'Your left hand is fused to an old iron lantern.',
  'It is lit — but there is no flame inside.',
  'Just a small, cold moon.',
];
function runIntro() {
  let i = 0, buf = '';
  const tick = () => {
    if (i < INTRO.length) {
      buf += (i ? '\n' : '') + INTRO[i];
      introLinesEl.textContent = buf;
      i++;
      setTimeout(tick, 950);
    } else {
      document.getElementById('title-card').classList.remove('hidden');
      document.getElementById('title-sub').classList.remove('hidden');
      document.getElementById('begin').classList.remove('hidden');
      document.getElementById('controls-hint').classList.remove('hidden');
    }
  };
  tick();
}
runIntro();

document.getElementById('begin').addEventListener('click', () => {
  audio.init();
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  // wake at the funeral home, looking south into Gravewick
  player.spawnAt(world.funeralHome.x, world.funeralHome.z + 9, Math.PI);
  weapons.setMode('gun');
  started = true;
  quests.start();
  canvas.requestPointerLock();
});

document.getElementById('respawn').addEventListener('click', () => {
  player.respawn();
  canvas.requestPointerLock();
});

// ---------- Loop ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (!started) { renderer.render(scene, camera); return; }

  if (!paused && !mapOpen && !items.reading) {
    // continuous fire while LMB held (revolver auto-paces via cooldown)
    if (lmb) weapons.primary();
    if (rmb) weapons.secondary();
    player.update(dt, input);
    weapons.update(dt);
    enemies.update(dt);
    items.update(dt);
    quests.update(dt);
    world.update(dt, player.pos);
  } else {
    // still let the world breathe a little while paused so it isn't frozen-dead
    world.update(dt * 0.2, player.pos);
  }

  updateHUD(dt);
  if (mapOpen) drawMap();
  renderer.render(scene, camera);
}
loop();

// expose for debugging in console
window.HALLOWIND = { scene, world, player, enemies, weapons, quests };
