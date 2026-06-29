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
import { Dialogue } from './dialogue.js';
import { NPCs } from './npc.js';
import { Interiors } from './interiors.js';
import { Events } from './events.js';
import { Save } from './save.js';
import { Factions, FACTIONS } from './factions.js';
import { Bells, ENDINGS } from './bells.js';
import { BACKGROUNDS } from './backgrounds.js';
import { Warden } from './warden.js';
import { CONSUMABLES, useConsumable, quickHeal } from './inventory.js';
import { PERKS, buyPerk, canBuy, reapplyPerks } from './perks.js';
import { setupTouch, isTouchDevice } from './touch.js';
import { clamp, dist2D, TAU, showToast } from './utils.js';

// ---------- Renderer / Scene / Camera ----------
const canvas = document.getElementById('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  // WebGL disabled/unavailable — surface a readable message instead of a blank page.
  try {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#08060c;color:#e8d8b0;font:16px/1.6 Georgia,serif;text-align:center;padding:24px;z-index:999';
    d.textContent = 'HALLOWIND needs WebGL, which your browser or device has disabled. Try another browser, or enable hardware acceleration, then reload.';
    document.body.appendChild(d);
  } catch (e2) {}
  throw err;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1600);
scene.add(camera);

// ---- procedural image-based lighting: gives every PBR surface real
//      reflections + dimensional shading (huge step up from flat matte).
//      Fully guarded so it never breaks construction or the test harness. ----
(function setupIBL() {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const dome = new THREE.SphereGeometry(40, 24, 16);
    const cols = [], p = dome.attributes.position;
    const top = new THREE.Color(0x0a1230), bot = new THREE.Color(0x2a1c30);
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, p.getY(i) / 40 * 0.5 + 0.5));
      const c = bot.clone().lerp(top, t); cols.push(c.r, c.g, c.b);
    }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    envScene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 16), new THREE.MeshBasicMaterial({ color: 0x9fb6ff }));
    moon.position.set(-18, 15, -22); envScene.add(moon);
    const warm = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff8a30 }));
    warm.position.set(13, -5, 11); envScene.add(warm);
    scene.environment = pmrem.fromScene(envScene, 0.06).texture;
    pmrem.dispose();
  } catch (e) { /* IBL is optional polish */ }
})();

// ---- cinematic colour-grade / vignette / grain / chromatic-aberration ----
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uBlood: { value: 0 },
    uVignette: { value: 0.85 }, uGrain: { value: 0.05 }, uAber: { value: 0.0016 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime,uBlood,uVignette,uGrain,uAber; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    void main(){
      vec2 d = vUv-0.5;
      float ca = uAber*(dot(d,d)*2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d*ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d*ca).b;
      float lum = dot(col, vec3(0.299,0.587,0.114));
      // teal shadows, warm highlights (autumn-gothic grade)
      col += vec3(0.03,0.06,0.11)*(1.0-lum) + vec3(0.10,0.045,0.0)*lum;
      col = clamp((col-0.5)*1.13+0.5, 0.0, 1.0);   // gentle contrast
      col.r += uBlood*0.12*(1.0-lum); col.gb -= uBlood*0.045;  // blood-moon
      float vig = smoothstep(1.15, 0.30, length(d)*1.45);
      col *= mix(1.0, vig, uVignette);
      col += (hash(vUv*vec2(1280.0,720.0)+fract(uTime))-0.5)*uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ---- optional bloom + grade post-processing (degrades gracefully) ----
let composer = null, bloomPass = null, gradePass = null;
(async () => {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'),
    ]);
    const c = new EffectComposer(renderer);
    c.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.5, 0.84);
    c.addPass(bloomPass);
    c.addPass(new OutputPass());
    gradePass = new ShaderPass(GradeShader);
    c.addPass(gradePass);
    c.setSize(innerWidth, innerHeight);
    composer = c;
  } catch (e) {
    composer = null;  // fall back to plain rendering — game unaffected
  }
})();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});

// ---------- Systems ----------
const audio = new Audio();
const world = new World(scene, 1031).build();
const player = new Player(camera, world, audio);
const quests = new Quests(world, player, audio);
const enemies = new Enemies(scene, world, player, audio);
const weapons = new Weapons(camera, scene, player, enemies, audio);
const items = new Items(scene, world, player, audio, quests);
const dialogue = new Dialogue(player);
const factions = new Factions(player);
const npcs = new NPCs(scene, world, player, audio, dialogue, enemies, quests);
const interiors = new Interiors(scene, world, player, enemies, audio, dialogue, npcs);
const events = new Events(scene, world, player, audio, dialogue, enemies);
const bells = new Bells(scene, world, player, audio, dialogue, factions, quests);
const warden = new Warden(player, factions, quests);
const save = new Save(player, quests, npcs, weapons);

player.weaponsRef = weapons;
enemies.factions = factions;
enemies.warden = warden;
npcs.factions = factions;
npcs.wardenRef = warden;
quests.bellsRef = bells;
bells.onSilence = () => warden.onBellSilenced();
save.factions = factions;
save.bells = bells;
save.warden = warden;
save.reapplyPerks = reapplyPerks;
enemies.onBossDefeated = () => { quests.onBossDefeated(); bells.onMarrowJack(); };
enemies.onEngineDefeated = () => bells.setEngineDead();
bells.onEnding = (ending) => showEnding(ending);
world.onBloodMoon = (on) => {
  const ban = document.getElementById('bloodmoon-banner');
  if (on) {
    ban.classList.add('show'); audio.bossRoar(); setTimeout(() => audio.bell(110), 600);
    setTimeout(() => ban.classList.remove('show'), 4200);
    player.addDread(20); showToast('Lock your doors. Hallow County is hunting tonight.');
    npcs.panic(true);
  } else {
    ban.classList.remove('show'); showToast('The blood moon sets. The dark settles — for now.');
    npcs.panic(false);
  }
};
save.onForceExitInterior = () => { if (interiors.active) { player.interior = null; interiors.active = null; enemies.suspended = false; scene.fog.density = 0.0065; world.setInteriorMuted(false); } };

// pointer-lock can throw a SecurityError (or reject its promise) in modern
// browsers if called outside a user gesture — wrap it so it can never surface.
function lockPointer() {
  try {
    const r = canvas.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) {}
}

// re-capture the mouse after any overlay closes
function relock() { if (started && !uiBlocking() && !isTouchDevice() && document.pointerLockElement !== canvas) lockPointer(); }
npcs.onDialogueOpen = () => {}; npcs.onDialogueClose = relock;
events.onDialogueOpen = () => {}; events.onDialogueClose = relock;
bells.onDialogueOpen = () => {}; bells.onDialogueClose = relock;
interiors.onReaderClose = relock; interiors.onReaderOpen = () => {};

document.getElementById('loading').classList.add('hidden');

// ---------- Interaction (unified across providers) ----------
const providers = [items, npcs, interiors, events, bells];
function getNearest() {
  let best = null, bd = Infinity;
  for (const prov of providers) {
    const n = prov.nearest(player.pos);
    if (n) {
      const d = dist2D(player.pos.x, player.pos.z, n.pos.x, n.pos.z);
      if (d < bd) { bd = d; best = n; }
    }
  }
  return best;
}

// ---------- UI state ----------
const readerEl = document.getElementById('reader');
const readerOpen = () => !readerEl.classList.contains('hidden');
function closeReader() { readerEl.classList.add('hidden'); items.reading = false; relock(); }
const journalEl = document.getElementById('journal');
const endingEl = document.getElementById('ending');
const inventoryEl = document.getElementById('inventory');
const perksEl = document.getElementById('perks');
const journalOpen = () => !journalEl.classList.contains('hidden');
const endingOpen = () => !endingEl.classList.contains('hidden');
const inventoryOpen = () => !inventoryEl.classList.contains('hidden');
const perksOpen = () => !perksEl.classList.contains('hidden');
function uiBlocking() {
  return paused || mapOpen || readerOpen() || dialogue.active || npcs.shopOpen || interiors._fading
    || journalOpen() || endingOpen() || inventoryOpen() || perksOpen();
}

// ---------- Input ----------
const input = { fwd: false, back: false, left: false, right: false, sprint: false, jump: false };
let started = false, paused = false, mapOpen = false;

const keyMap = {
  KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
};

addEventListener('keydown', (e) => {
  if (!started) return;
  if (keyMap[e.code] !== undefined) input[keyMap[e.code]] = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = true;
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }

  // overlay-dismiss keys
  if (e.code === 'Escape') {
    if (readerOpen()) return closeReader();
    if (npcs.shopOpen) { npcs.closeShop(); return; }
    if (dialogue.active) { dialogue.close(); return; }
    if (journalOpen()) { toggleJournal(); return; }
    if (inventoryOpen()) { toggleInventory(); return; }
    if (perksOpen()) { togglePerks(); return; }
    if (mapOpen) { toggleMap(); return; }
  }
  if (journalOpen()) { if (e.code === 'KeyJ') toggleJournal(); return; }
  if (inventoryOpen()) { if (e.code === 'KeyI') toggleInventory(); return; }
  if (perksOpen()) { if (e.code === 'KeyP') togglePerks(); return; }
  if (endingOpen()) return;
  if (readerOpen()) { if (e.code === 'KeyE') closeReader(); return; }
  if (npcs.shopOpen) { if (e.code === 'KeyE') { npcs.closeShop(); } return; }
  if (dialogue.active) return;

  switch (e.code) {
    case 'KeyF': player.toggleLantern(); break;
    case 'KeyQ': weapons.flare(); break;
    case 'KeyR': weapons.reload(); break;
    case 'Digit1': weapons.setMode('gun'); break;
    case 'Digit2': weapons.setMode('spell'); break;
    case 'Digit3': weapons.equipSpell(0); break;
    case 'Digit4': weapons.equipSpell(1); break;
    case 'Digit5': weapons.equipSpell(2); break;
    case 'Digit6': weapons.equipSpell(3); break;
    case 'Digit7': weapons.equipSpell(4); break;
    case 'Digit8': weapons.equipSpell(5); break;
    case 'KeyE': { const n = getNearest(); if (n) n.run(); break; }
    case 'KeyK': save.save(true); break;
    case 'KeyL': save.load(); break;
    case 'KeyJ': toggleJournal(); break;
    case 'KeyI': toggleInventory(); break;
    case 'KeyP': togglePerks(); break;
    case 'KeyC': player.toggleCrouch(); break;
    case 'KeyH': quickHeal(player); break;
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
  if (!started || uiBlocking()) return;
  if (document.pointerLockElement === canvas) player.addLook(e.movementX, e.movementY);
});
let lmb = false, rmb = false;
canvas.addEventListener('mousedown', (e) => {
  if (!started || uiBlocking() || isTouchDevice()) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (e.button === 0) { lmb = true; weapons.primary(); }
  if (e.button === 2) { rmb = true; weapons.secondary(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (!started || uiBlocking() || weapons.mode !== 'spell') return;
  weapons.cycleSpell(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ---------- Touch / mobile controls ----------
setupTouch({
  move: (mx, my) => { input.mx = mx; input.my = my; },
  look: (dx, dy) => { if (started && !uiBlocking()) player.addLook(dx, dy, 0.005); },
  fireDown: () => { if (started && !uiBlocking()) { lmb = true; weapons.primary(); } },
  fireUp: () => { lmb = false; },
  cast: () => { if (started && !uiBlocking()) weapons.secondary(); },
  lantern: () => { if (started) player.toggleLantern(); },
  flare: () => { if (started && !uiBlocking()) weapons.flare(); },
  reload: () => { if (started && !uiBlocking()) weapons.reload(); },
  jump: () => { if (started && !uiBlocking()) { input.jump = true; setTimeout(() => input.jump = false, 130); } },
  crouch: () => { if (started) player.toggleCrouch(); },
  interact: () => { if (started && !uiBlocking()) { const n = getNearest(); if (n) n.run(); } else if (readerOpen()) closeReader(); },
  bag: () => { if (started) toggleInventory(); },
});

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
  else if (!mapOpen) relock();
}
function drawMap() {
  const W = mapCanvas.width, H = mapCanvas.height, scale = W / (world.WORLD * 2);
  mctx.fillStyle = '#0b0d12'; mctx.fillRect(0, 0, W, H);
  const toX = (x) => W / 2 + x * scale, toY = (z) => H / 2 + z * scale;
  for (const r of REGIONS) {
    mctx.beginPath(); mctx.arc(toX(r.x), toY(r.z), r.r * scale, 0, TAU);
    mctx.fillStyle = 'rgba(255,122,24,0.06)'; mctx.fill();
    mctx.strokeStyle = 'rgba(255,122,24,0.4)'; mctx.lineWidth = 1; mctx.stroke();
    mctx.fillStyle = '#9fb3c8'; mctx.font = '11px Georgia'; mctx.textAlign = 'center';
    mctx.fillText(r.name, toX(r.x), toY(r.z));
  }
  // doors / interiors
  for (const d of interiors.doors) {
    mctx.fillStyle = '#e8c46a'; mctx.fillRect(toX(d.x) - 3, toY(d.z) - 3, 6, 6);
  }
  const tgt = quests.objectiveTarget();
  if (tgt) { mctx.beginPath(); mctx.arc(toX(tgt.x), toY(tgt.z), 6, 0, TAU); mctx.fillStyle = '#8dff6a'; mctx.fill(); }
  mctx.save();
  mctx.translate(toX(player.pos.x), toY(player.pos.z)); mctx.rotate(-player.yaw);
  mctx.fillStyle = '#ff7a18'; mctx.beginPath();
  mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(-5, 6); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// fast travel: click a discovered region on the map
mapCanvas.addEventListener('click', (e) => {
  if (!mapOpen) return;
  const rect = mapCanvas.getBoundingClientRect();
  const scale = mapCanvas.width / (world.WORLD * 2);
  const mx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
  const my = (e.clientY - rect.top) * (mapCanvas.height / rect.height);
  const wx = (mx - mapCanvas.width / 2) / scale, wz = (my - mapCanvas.height / 2) / scale;
  for (const r of REGIONS) {
    if (dist2D(wx, wz, r.x, r.z) < r.r * 0.6) {
      const discovered = r.id === 'gravewick' || quests.visited.has(r.id);
      if (!discovered) { showToast(`${r.name} — undiscovered. Travel there on foot first.`); return; }
      if (player.interior) { showToast('Not from in here.'); return; }
      toggleMap();
      interiors._fade('the black carriage knows every road', () => {
        player.spawnAt(r.x, r.z + 6, Math.PI);
      });
      return;
    }
  }
});

// ---------- Compass ----------
const compassNeedle = document.getElementById('compass-needle');
function updateCompass() {
  const marks = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];
  const center = 120, span = 240 / Math.PI;
  const rel = (angle) => { let d = angle - player.yaw; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
  const items2 = marks.map(([l, a]) => ({ l, x: center + rel(a) * span }));
  const tgt = quests.objectiveTarget();
  if (tgt && !player.interior) {
    const ang = Math.atan2(tgt.x - player.pos.x, tgt.z - player.pos.z);
    items2.push({ l: '◈', x: center + rel(ang) * span });
  }
  compassNeedle.innerHTML = items2.filter(m => m.x > -10 && m.x < 250)
    .map(m => `<span style="position:absolute;left:${m.x}px;transform:translateX(-50%);${m.l === '◈' ? 'color:#8dff6a' : ''}">${m.l}</span>`).join('');
  compassNeedle.style.position = 'relative'; compassNeedle.style.height = '20px'; compassNeedle.style.display = 'block';
}

// ---------- Journal ----------
function toggleJournal() {
  const open = !journalOpen();
  journalEl.classList.toggle('hidden', !open);
  if (open) { renderJournal(); if (document.pointerLockElement) document.exitPointerLock(); }
  else relock();
}
function renderJournal() {
  document.getElementById('j-objective').textContent = quests.steps[quests.step].text;

  const wardenBox = document.getElementById('j-warden');
  if (wardenBox) wardenBox.innerHTML = warden.journalLines().map(l => `<div class="j-bell">${l}</div>`).join('');

  const bellsBox = document.getElementById('j-bells');
  const dispLabel = { silence: 'Silenced', bind: 'Bound', give_church: 'Given · Church', give_court: 'Given · Court', feed: 'Fed to October' };
  bellsBox.innerHTML = bells.list.map(b => {
    if (b.resolved) return `<div class="j-bell">✓ ${b.name} <span class="d">— ${dispLabel[b.disposition] || 'resolved'}</span></div>`;
    const gated = b.gate && !bells._gateOpen(b.gate);
    return `<div class="j-bell unresolved">○ ${b.name}${gated ? ' <span class="d">(sealed)</span>' : ''}</div>`;
  }).join('') + `<div class="j-bell" style="margin-top:6px">Bells dealt with: <b>${bells.resolved}</b> / ${bells.list.length}</div>`;

  const curseBox = document.getElementById('j-curse');
  curseBox.innerHTML = `<div class="j-row"><span>October's hold</span><span class="v">${Math.round(bells.curse)} / 100</span></div>
    <div class="curse-track"><div class="curse-fill" style="width:${bells.curse}%"></div></div>
    <div class="j-row" style="margin-top:6px"><span>Dread</span><span class="v">${Math.round(player.dread)}</span></div>`;

  const facBox = document.getElementById('j-factions');
  facBox.innerHTML = FACTIONS.map(f => {
    const s = factions.standing(f.id);
    const pct = (s.value + 100) / 2;
    return `<div class="j-row"><span style="color:${f.color}">${f.name}</span><span class="v">${s.label}</span></div>
      <div class="fac-bar"><div class="fac-fill" style="width:${pct}%;background:${f.color}"></div></div>`;
  }).join('');

  const st = player.stats;
  document.getElementById('j-stats').innerHTML =
    `<div class="j-row"><span>Level</span><span class="v">${player.level}</span></div>` +
    `<div class="j-row"><span>Soulgilt</span><span class="v">◉ ${player.coin}</span></div>` +
    Object.entries(st).map(([k, v]) => `<div class="j-row"><span>${k[0].toUpperCase() + k.slice(1)}</span><span class="v">${v}</span></div>`).join('') +
    `<div class="j-row"><span>Companion</span><span class="v">${npcs.companion ? npcs.companion.name : '—'}</span></div>`;
}

// ---------- Inventory ----------
function toggleInventory() {
  const open = !inventoryOpen();
  inventoryEl.classList.toggle('hidden', !open);
  if (open) { renderInventory(); if (document.pointerLockElement) document.exitPointerLock(); }
  else relock();
}
function renderInventory() {
  const cBox = document.getElementById('inv-consumables');
  const ids = Object.keys(player.consumables).filter(id => player.consumables[id] > 0);
  cBox.innerHTML = ids.length ? ids.map(id => {
    const c = CONSUMABLES[id]; if (!c) return '';
    return `<div class="inv-row"><div class="info"><b>${c.name} ×${player.consumables[id]}</b><small>${c.desc}</small></div>
      <button class="use-btn" data-use="${id}">USE</button></div>`;
  }).join('') : '<div class="inv-row empty">empty — buy supplies at the Mask Market</div>';
  cBox.querySelectorAll('.use-btn').forEach(b => b.onclick = () => { useConsumable(player, b.dataset.use); renderInventory(); });

  const kBox = document.getElementById('inv-keyitems');
  kBox.innerHTML = player.keyItems.length ? player.keyItems.map(k =>
    `<div class="inv-row"><div class="info"><b>${k.name}</b><small>${k.desc}</small></div></div>`).join('')
    : '<div class="inv-row empty">no relics yet — bosses and haunts hold the best</div>';
}

// ---------- Perks ----------
function togglePerks() {
  const open = !perksOpen();
  perksEl.classList.toggle('hidden', !open);
  if (open) { renderPerks(); if (document.pointerLockElement) document.exitPointerLock(); }
  else relock();
}
function renderPerks() {
  document.getElementById('perk-points').textContent = `· ${player.skillPoints} point${player.skillPoints === 1 ? '' : 's'}`;
  const grid = document.getElementById('perks-grid');
  grid.innerHTML = PERKS.map(perk => {
    const owned = player.perks.includes(perk.id);
    const c = canBuy(player, perk);
    const btn = owned ? `<span class="pc-owned">✓ owned</span>`
      : `<button class="pc-buy" data-perk="${perk.id}" ${c.ok ? '' : 'disabled'}>${c.ok ? `take · ${perk.cost} pt` : c.why}</button>`;
    return `<div class="perk-card ${owned ? 'owned' : ''}"><div class="pc-cat">${perk.cat}</div>
      <div class="pc-name">${perk.name}</div><div class="pc-desc">${perk.desc}</div>${btn}</div>`;
  }).join('');
  grid.querySelectorAll('.pc-buy').forEach(b => b.onclick = () => { buyPerk(player, b.dataset.perk); renderPerks(); });
}

// ---------- Ending ----------
function showEnding(ending) {
  const data = ENDINGS[ending] || ENDINGS.seal;
  document.getElementById('ending-title').textContent = data.title;
  document.getElementById('ending-body').textContent = data.body;
  const counts = {};
  for (const d of bells.dispositions) counts[d] = (counts[d] || 0) + 1;
  document.getElementById('ending-stats').textContent =
    `October's hold: ${Math.round(bells.curse)} · Bells: ${bells.resolved}/${bells.list.length} · Level ${player.level} · Dread ${Math.round(player.dread)}`;
  endingEl.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  audio.bell(ending === 'november' ? 110 : 220);
  setTimeout(() => audio.bell(160), 900);
}
document.getElementById('ending-again').addEventListener('click', () => {
  try { localStorage.removeItem('hallowind.save.v1'); } catch {}
  location.reload();
});

// ---------- HUD ----------
let clockMin = 11 * 60 + 54;
function updateHUD(dt) {
  document.getElementById('health-fill').style.width = `${clamp(player.hp / player.maxHP, 0, 1) * 100}%`;
  document.getElementById('wisp-fill').style.width = `${clamp(player.wisp / player.maxWisp, 0, 1) * 100}%`;
  document.getElementById('dread-fill').style.width = `${player.dread}%`;

  if (!player.interior) {
    const reg = world.regionAt(player.pos.x, player.pos.z);
    const rn = document.getElementById('region-name');
    if (rn.textContent !== reg.name) {
      rn.textContent = reg.name;
      audio.setRegionWind(reg.wind);
      scene.fog.color.setHex(reg.fog);
    }
  }
  audio.setDread(player.dread01());

  clockMin += dt * 0.2;
  let hr = Math.floor(clockMin / 60) % 24, mn = Math.floor(clockMin % 60);
  const ampm = hr >= 12 ? 'PM' : 'AM'; let h12 = hr % 12; if (h12 === 0) h12 = 12;
  const clockEl = document.getElementById('clock');
  clockEl.textContent = `${h12}:${String(mn).padStart(2, '0')} ${ampm} · ${world.nightPhaseName()}`;
  clockEl.style.color = world.isBloodMoon() ? '#e23b2a' : '';
  // smooth blood-moon vignette
  document.getElementById('bloodmoon-overlay').style.opacity = (world._blood || 0).toFixed(2);

  renderSpellbar();

  // stealth indicator
  const stEl = document.getElementById('stealth');
  stEl.classList.toggle('seen', player.detected);
  stEl.classList.toggle('crouch', player.crouched);
  document.getElementById('stealth-text').textContent =
    player.detected ? 'SPOTTED' : (player.crouched ? 'SNEAKING' : 'HIDDEN');

  const near = uiBlocking() ? null : getNearest();
  const prompt = document.getElementById('prompt');
  if (near) { prompt.classList.add('show'); document.getElementById('prompt-text').textContent = near.prompt; }
  else prompt.classList.remove('show');

  updateCompass();
}

// spell bar (only while the lantern hand is active)
const spellbarEl = document.getElementById('spellbar');
function renderSpellbar() {
  if (weapons.mode !== 'spell') { spellbarEl.classList.add('hidden'); return; }
  spellbarEl.classList.remove('hidden');
  spellbarEl.innerHTML = weapons.spells.map((s, i) => {
    const unlocked = weapons.spellUnlocked(s);
    const eq = i === weapons.spellIndex;
    const cls = ['spell-chip', unlocked ? 'unlocked' : '', eq ? 'equipped' : '', (eq && weapons.spellCd > 0) ? 'cooling' : ''].filter(Boolean).join(' ');
    const label = unlocked ? s.name : `${s.name} · Hex ${s.reqHex}`;
    return `<div class="${cls}"><span class="hk">${i + 3}</span>${label}</div>`;
  }).join('');
}

// ---------- Intro ----------
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
      buf += (i ? '\n' : '') + INTRO[i]; introLinesEl.textContent = buf; i++;
      setTimeout(tick, 950);
    } else {
      // the prologue has played — collapse it so the menu fits without scrolling
      const lines = document.getElementById('intro-lines');
      lines.style.transition = 'opacity .8s, max-height .8s, margin .8s';
      lines.style.opacity = '0'; lines.style.maxHeight = '0'; lines.style.minHeight = '0';
      lines.style.overflow = 'hidden'; lines.style.margin = '0';
      ['title-card', 'title-sub', 'bg-select', 'begin', 'controls-hint'].forEach(id => document.getElementById(id).classList.remove('hidden'));
      renderBackgroundCards();
      if (save.has()) {
        const b = document.getElementById('begin');
        const cont = document.createElement('button');
        cont.textContent = 'CONTINUE LOOP'; cont.style.marginLeft = '14px';
        cont.onclick = () => beginGame(true);
        b.after(cont);
      }
    }
  };
  tick();
}
runIntro();

let selectedBg = 0;
function renderBackgroundCards() {
  const box = document.getElementById('bg-cards');
  box.innerHTML = BACKGROUNDS.map((b, i) => `
    <div class="bg-card${i === selectedBg ? ' sel' : ''}" data-i="${i}">
      <div class="bn">${b.name}</div>
      <div class="bd">${b.blurb}</div>
      <div class="bp">${b.perk}</div>
    </div>`).join('');
  box.querySelectorAll('.bg-card').forEach(el => {
    el.addEventListener('click', () => { selectedBg = +el.dataset.i; renderBackgroundCards(); });
  });
}

// menu music starts on the first interaction with the intro (audio needs a gesture)
let introAudioOn = false;
document.getElementById('intro').addEventListener('pointerdown', () => {
  if (introAudioOn) return; introAudioOn = true;
  audio.init(); audio.startMusic('menu');
});

function beginGame(loadSave) {
  audio.init();
  audio.stopMusic(); setTimeout(() => audio.startMusic('game'), 700);
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  player.spawnAt(world.funeralHome.x, world.funeralHome.z + 9, Math.PI);
  if (!loadSave) {
    const bg = BACKGROUNDS[selectedBg];
    bg.apply(player, weapons, factions);
    document.getElementById('level').textContent = `${bg.name} · Lv ${player.level}`;
    showToast(`You were ${bg.name}.`);
  }
  weapons.setMode('gun');
  document.getElementById('coin-n').textContent = player.coin;
  started = true;
  quests.start();
  if (loadSave) save.load();
  if (!isTouchDevice()) lockPointer();
}
document.getElementById('begin').addEventListener('click', () => beginGame(false));
document.getElementById('respawn').addEventListener('click', () => {
  // if you died inside a haunt, the loop spits you back into the overworld
  if (interiors.active) { interiors.active = null; enemies.suspended = false; scene.fog.density = 0.0065; world.setInteriorMuted(false); }
  player.respawn();
  scene.fog.color.setHex(world.regionAt(player.pos.x, player.pos.z).fog);
  relock();
});

// ---------- Loop ----------
const clock = new THREE.Clock();
let _gradeT = 0;
function renderFrame() {
  if (composer) {
    try {
      bloomPass.strength = 0.62 + (world._blood || 0) * 0.55;
      if (gradePass) {
        _gradeT += 0.016;
        gradePass.uniforms.uTime.value = _gradeT;
        gradePass.uniforms.uBlood.value = world._blood || 0;
      }
      composer.render();
      return;
    } catch (e) {
      composer = null;   // a runtime GL failure → permanently fall back, never break the loop
    }
  }
  renderer.render(scene, camera);
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (!started) { renderFrame(); return; }

  const blocked = uiBlocking();
  if (!blocked) {
    if (lmb) weapons.primary();
    if (rmb) weapons.secondary();
    player.update(dt, input);
    weapons.update(dt);
    enemies.update(dt);
    items.update(dt);
    npcs.update(dt);
    events.update(dt);
    bells.update(dt);
    quests.update(dt);
    world.update(dt, player.pos);
    save.update(dt);
  } else {
    world.update(dt * 0.15, player.pos);
  }

  updateHUD(dt);
  if (mapOpen) drawMap();
  renderFrame();
}
loop();

window.HALLOWIND = { scene, world, player, enemies, weapons, quests, npcs, interiors, events, save, dialogue, factions, bells, warden };
