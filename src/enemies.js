// ============================================================
// enemies.js — the Halloween bestiary + their AI, and the giant
// scarecrow boss Marrow Jack. State-machine driven, terrain-aware.
//
//  Scarecrow  — freezes when watched, sprints when unseen.
//  Jackling   — fast little pumpkin-headed swarm.
//  Ghost      — only harmed by the lantern's light, witchfire, or flare.
//  Marrow Jack— three-phase field boss with adds & pumpkin bombs.
// ============================================================
import * as THREE from 'three';
import { dist2D, clamp, randRange, TAU, showToast, whisper } from './utils.js';

let _eid = 0;

export class Enemies {
  constructor(scene, world, player, audio) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.list = [];
    this.hitMeshes = [];      // flat list for raycasting
    this.spawnCd = 2;
    this.maxAmbient = 14;
    this.boss = null;
    this.bossTriggered = false;
    this.engineTriggered = false;
    this.kills = 0;
    this._camForward = new THREE.Vector3();
  }

  // ---------- factory ----------
  _register(e) {
    e.id = _eid++;
    // stealth: enemies start unaware and only hunt once they detect you
    const AGGRO = { scarecrow: 16, jackling: 19, ghost: 14, doll: 15, werebeast: 22, leech: 18 };
    if (e.aware === undefined) e.aware = !!e.isBoss;
    if (e.aggro === undefined) e.aggro = e.isBoss ? 999 : (AGGRO[e.type] || 16);
    e.homeX = e.group.position.x; e.homeZ = e.group.position.z;
    this.list.push(e);
    e.group.traverse(o => { if (o.isMesh) { o.userData.enemy = e; this.hitMeshes.push(o); } });
    this.scene.add(e.group);
    return e;
  }
  _deregister(e) {
    this.scene.remove(e.group);
    e.group.traverse(o => {
      const i = this.hitMeshes.indexOf(o);
      if (i >= 0) this.hitMeshes.splice(i, 1);
      if (o.isMesh) { o.geometry.dispose?.(); }
    });
    const li = this.list.indexOf(e);
    if (li >= 0) this.list.splice(li, 1);
  }

  spawnScarecrow(x, z) {
    const g = new THREE.Group();
    const strawMat = new THREE.MeshStandardMaterial({ color: 0x7a5e26, roughness: 1, flatShading: true });
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x40301a, roughness: 1 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.18, 1.3, 8), clothMat);
    body.position.y = 1.5; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), strawMat);
    head.position.y = 2.35; head.scale.y = 1.15; head.castShadow = true; g.add(head);
    // glowing stitched eyes
    const em = new THREE.MeshBasicMaterial({ color: 0xff5a18 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), em); e1.position.set(-0.11, 2.38, 0.25); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.11; g.add(e2);
    // outstretched arms
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 1.4, 6), strawMat);
    arm.rotation.z = Math.PI / 2; arm.position.y = 1.95; g.add(arm);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 1.0, 6), clothMat);
    legs.position.y = 0.5; g.add(legs);

    g.position.set(x, this.world.getHeight(x, z), z);
    return this._register({
      type: 'scarecrow', group: g, head,
      hp: 55, maxHp: 55, speed: 7.2, dmg: 14, atkCd: 0, atkRange: 2.4,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, watched: false,
      resist: { silver: 1, witchfire: 1.8 }, dread: 0.2, xp: 22,
    });
  }

  spawnJackling(x, z) {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.7, emissive: 0x3a1400, emissiveIntensity: 0.6 }));
    head.scale.y = 0.85; head.castShadow = true; g.add(head);
    const fm = new THREE.MeshBasicMaterial({ color: 0xffae3b });
    const eye = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.1, 3), fm);
    eye.rotation.x = Math.PI / 2; eye.position.set(-0.12, 0.05, 0.28); g.add(eye);
    const eye2 = eye.clone(); eye2.position.x = 0.12; g.add(eye2);
    // little vine legs
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x2e3d18, roughness: 1 }));
    body.position.y = -0.4; body.rotation.x = Math.PI; g.add(body);
    const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xff7a1e, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    light.scale.setScalar(1.4); g.add(light);

    g.position.set(x, this.world.getHeight(x, z) + 0.9, z);
    return this._register({
      type: 'jackling', group: g, head,
      hp: 22, maxHp: 22, speed: 8.6, dmg: 8, atkCd: 0, atkRange: 1.8,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, hover: 0.9,
      resist: { silver: 1, witchfire: 1.4 }, dread: 0.1, xp: 10,
    });
  }

  spawnGhost(x, z) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xbfe0ff, transparent: true, opacity: 0.32, emissive: 0x335577,
      emissiveIntensity: 0.6, depthWrite: false,
    });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 10, 1, true), mat);
    body.position.y = 1.4; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), mat);
    head.position.y = 2.1; g.add(head);
    const em = new THREE.MeshBasicMaterial({ color: 0x113344 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), em); e1.position.set(-0.1, 2.12, 0.26); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.1; g.add(e2);

    g.position.set(x, this.world.getHeight(x, z), z);
    return this._register({
      type: 'ghost', group: g, head, mat,
      hp: 48, maxHp: 48, speed: 4.4, dmg: 12, atkCd: 0, atkRange: 2.6,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, phaseT: Math.random() * TAU,
      resist: { silver: 0.04, witchfire: 1.6 }, dread: 0.5, xp: 26, vulnerable: false,
    });
  }

  spawnDoll(x, z, mother = false) {
    const g = new THREE.Group();
    const porc = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.4, metalness: 0.05 });
    const dress = new THREE.MeshStandardMaterial({ color: mother ? 0x4a1020 : 0x6a2030, roughness: 1 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), porc);
    head.position.y = 1.0; head.castShadow = true; g.add(head);
    // cracked black button eyes
    const em = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), em); e1.position.set(-0.1, 1.03, 0.22); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.1; g.add(e2);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), em); mouth.position.set(0, 0.88, 0.24); g.add(mouth);
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 8), dress);
    body.position.y = 0.5; body.castShadow = true; g.add(body);
    // porcelain limbs
    for (const sx of [-0.22, 0.22]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), porc);
      arm.position.set(sx, 0.7, 0); arm.rotation.z = sx > 0 ? 0.6 : -0.6; g.add(arm);
    }
    g.position.set(x, this.world.getHeight(x, z), z);
    if (mother) g.scale.setScalar(2.1);
    return this._register({
      type: 'doll', group: g, head, isMother: mother,
      hp: mother ? 300 : 18, maxHp: mother ? 300 : 18,
      speed: mother ? 5 : 9.2, dmg: mother ? 16 : 7, atkCd: 0, atkRange: mother ? 3 : 1.7,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, hopPhase: Math.random() * TAU, addCd: 3,
      resist: { silver: 0.45, witchfire: 1.25 }, dread: mother ? 0.6 : 0.25, xp: mother ? 170 : 12,
    });
  }

  spawnWerebeast(x, z) {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 1, flatShading: true });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.0, 4, 8), fur);
    torso.rotation.z = Math.PI / 2.3; torso.position.y = 1.2; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 7), fur);
    head.rotation.x = Math.PI / 2; head.position.set(0, 1.4, 0.7); head.castShadow = true; g.add(head);
    // human eyes
    const em = new THREE.MeshBasicMaterial({ color: 0xfff2a0 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), em); e1.position.set(-0.12, 1.5, 0.9); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
    // legs
    for (const sx of [-0.3, 0.3]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.06, 1.2, 6), fur);
      leg.position.set(sx, 0.55, -0.2); g.add(leg);
      const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.06, 1.2, 6), fur);
      leg2.position.set(sx, 0.55, 0.5); g.add(leg2);
    }
    g.position.set(x, this.world.getHeight(x, z), z);
    return this._register({
      type: 'werebeast', group: g, head,
      hp: 120, maxHp: 120, speed: 9.4, dmg: 22, atkCd: 0, atkRange: 2.6,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0,
      resist: { silver: 1.7, witchfire: 0.8 }, dread: 0.35, xp: 48,
    });
  }

  // Parlor Leech — ambient vampire aristocrat. Heals when it bites.
  spawnParlorLeech(x, z, weak = false) {
    const g = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: 0x140a14, roughness: 0.7, metalness: 0.1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe6ded6, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.7, 8), coat);
    body.position.y = 0.9; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), skin);
    head.position.y = 1.95; head.castShadow = true; g.add(head);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a1020, emissive: 0x300008, emissiveIntensity: 0.5 }));
    tie.position.set(0, 1.5, 0.28); g.add(tie);
    const em = new THREE.MeshBasicMaterial({ color: 0xb6202a });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), em); e1.position.set(-0.08, 1.98, 0.2); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.08; g.add(e2);
    g.position.set(x, this.world.getHeight(x, z), z);
    return this._register({
      type: 'leech', group: g, head,
      hp: weak ? 30 : 70, maxHp: weak ? 30 : 70, speed: weak ? 7 : 6.2, dmg: weak ? 9 : 14, atkCd: 0, atkRange: 2.2,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, drains: true,
      resist: { silver: 1.5, witchfire: 0.9 }, dread: 0.4, xp: weak ? 14 : 30,
    });
  }

  // ---------- boss ----------
  spawnPorcelainCount(x, z) {
    if (this.count) return;
    const g = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: 0x0e0a12, roughness: 0.5, metalness: 0.2 });
    const porc = new THREE.MeshStandardMaterial({ color: 0xeae2da, roughness: 0.25, metalness: 0.05 });
    const torso = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 8), coat);
    torso.position.y = 1.4; torso.castShadow = true; g.add(torso);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), porc);
    face.position.y = 3.0; face.castShadow = true; g.add(face);
    // cracked porcelain mask seams + red eyes
    const em = new THREE.MeshBasicMaterial({ color: 0xb6202a });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), em); e1.position.set(-0.12, 3.05, 0.28); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
    // red cravat
    const cravat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a1020, emissive: 0x400010, emissiveIntensity: 0.7 }));
    cravat.position.set(0, 2.3, 0.45); g.add(cravat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xb06adf, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(4); halo.position.y = 3; g.add(halo);
    g.position.set(x, this.world.getHeight(x, z), z); g.scale.setScalar(1.5);
    const boss = this._register({
      type: 'boss', group: g, face,
      hp: 850, maxHp: 850, speed: 6.5, dmg: 26, atkCd: 0, atkRange: 3,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, phase: 1,
      resist: { silver: 1.2, witchfire: 0.85 }, dread: 0, xp: 650, isBoss: true,
      bossKind: 'count', addCd: 4, dashCd: 2,
    });
    this.count = boss; this.boss = boss;
    this._showBossBar('THE PORCELAIN COUNT');
    this.audio.bossRoar();
    showToast('THE PORCELAIN COUNT requests the pleasure of your death');
    whisper('“you have tracked mud onto my century”');
    return boss;
  }

  spawnBoss(x, z) {
    if (this.boss) return;
    const g = new THREE.Group();
    const beam = new THREE.MeshStandardMaterial({ color: 0x33240f, roughness: 1, flatShading: true });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x271a0c, roughness: 1 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.9, 5, 8), cloth);
    torso.position.y = 5; torso.castShadow = true; g.add(torso);
    // dozens of burning pumpkins clustered as the head
    const headGrp = new THREE.Group(); headGrp.position.y = 8.4; g.add(headGrp);
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(randRange(Math.random, 0.4, 0.8), 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xd2691e, emissive: 0x4a1800, emissiveIntensity: 0.8, roughness: 0.7 }));
      p.position.set((Math.random()-0.5)*1.8, (Math.random()-0.5)*1.8, (Math.random()-0.5)*1.8);
      headGrp.add(p);
    }
    const hl = new THREE.PointLight(0xff5a1e, 2.5, 30, 2); hl.position.y = 8.4; g.add(hl);
    // crossbeam arms
    const arms = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 0.4), beam);
    arms.position.y = 6.5; g.add(arms);
    // scythe
    const scythe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 0.2), beam);
    scythe.position.set(4, 5, 0); g.add(scythe);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 0.7, roughness: 0.4 }));
    blade.position.set(4 - 1, 7, 0); g.add(blade);

    g.position.set(x, this.world.getHeight(x, z), z);
    g.scale.setScalar(1.6);
    const boss = this._register({
      type: 'boss', group: g, headGrp,
      hp: 900, maxHp: 900, speed: 3.2, dmg: 34, atkCd: 0, atkRange: 7,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, phase: 1,
      resist: { silver: 0.7, witchfire: 1.5 }, dread: 0, xp: 600, isBoss: true,
      addCd: 5, bombCd: 4,
    });
    boss.bossKind = 'marrow';
    this.boss = boss;
    this.bossTriggered = true;
    this._showBossBar('MARROW JACK');
    this.audio.bossRoar();
    showToast('MARROW JACK — Stitched King of the Thousand-Jack');
    whisper('learn its name, or burn it down');
    return boss;
  }

  spawnHarvestEngine(x, z) {
    if (this.engine) return;
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.6, roughness: 0.5, flatShading: true });
    const rust = new THREE.MeshStandardMaterial({ color: 0x4a2a18, metalness: 0.3, roughness: 0.9 });
    // stacked boiler body
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), iron); base.position.y = 1.5; base.castShadow = true; g.add(base);
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 4, 12), rust); boiler.position.y = 4.5; boiler.castShadow = true; g.add(boiler);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 3, 8), iron); stack.position.set(1.4, 7, -0.5); g.add(stack);
    // spinning gears (this is the "headGrp" the boss-think rotates)
    const gears = new THREE.Group(); gears.position.set(0, 4.2, 2.1); g.add(gears);
    for (let i = 0; i < 3; i++) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.8 - i * 0.18, 0.22, 6, 12), iron);
      gear.position.set(-1.4 + i * 1.4, i * 0.4, 0); gears.add(gear);
    }
    // furnace weak point — a cracked glowing pressure gauge / heart
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff3a10, emissive: 0xff3a10, emissiveIntensity: 1.4 }));
    heart.position.set(0, 2.2, 2.05); g.add(heart);
    const hl = new THREE.PointLight(0xff4a1e, 2.2, 26, 2); hl.position.set(0, 3, 2); g.add(hl);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xff5a1e, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    spr.scale.setScalar(4); spr.position.set(0, 3, 2.2); g.add(spr);

    g.position.set(x, this.world.getHeight(x, z), z);
    g.scale.setScalar(1.4);
    const boss = this._register({
      type: 'boss', group: g, headGrp: gears,
      hp: 1100, maxHp: 1100, speed: 1.3, dmg: 30, atkCd: 0, atkRange: 8,
      state: 'hunt', stagger: 0, dead: false, dyingT: 0, phase: 1,
      resist: { silver: 0.55, witchfire: 1.35 }, dread: 0, xp: 700, isBoss: true,
      addCd: 4, bombCd: 5, bossKind: 'engine',
    });
    this.engine = boss; this.boss = boss; this.engineTriggered = true;
    this._showBossBar('THE HARVEST ENGINE');
    this.audio.bossRoar();
    showToast('THE HARVEST ENGINE — the foundry will not clock out');
    whisper('exorcise the workers, then break its heart');
    return boss;
  }

  _showBossBar(name = 'MARROW JACK') {
    let bar = document.getElementById('boss-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'boss-bar';
      bar.innerHTML = `<div id="boss-name"></div><div id="boss-track"><div id="boss-fill"></div></div>`;
      Object.assign(bar.style, {
        position: 'fixed', left: '50%', bottom: '7%', transform: 'translateX(-50%)',
        width: '46%', textAlign: 'center', zIndex: 12, pointerEvents: 'none',
      });
      document.getElementById('hud').appendChild(bar);
      const nm = bar.querySelector('#boss-name');
      Object.assign(nm.style, { color: '#ff7a18', letterSpacing: '6px', fontSize: '15px', textShadow: '0 0 12px #802500' });
      const tr = bar.querySelector('#boss-track');
      Object.assign(tr.style, { height: '12px', marginTop: '5px', background: 'rgba(0,0,0,.6)', border: '1px solid #b6202a', borderRadius: '2px', overflow: 'hidden' });
      const fl = bar.querySelector('#boss-fill');
      Object.assign(fl.style, { height: '100%', width: '100%', background: 'linear-gradient(90deg,#7a0d12,#ff5a1e)' });
    }
    bar.querySelector('#boss-name').textContent = name;
    document.getElementById('boss-fill').style.width = '100%';
    bar.style.display = 'block';
  }
  _hideBossBar() { const b = document.getElementById('boss-bar'); if (b) b.style.display = 'none'; }

  // ---------- combat hooks (called by weapons.js) ----------
  raycastHit(raycaster) {
    const hits = raycaster.intersectObjects(this.hitMeshes, false);
    for (const h of hits) {
      const e = h.object.userData.enemy;
      if (e && !e.dead) return { enemy: e, point: h.point };
    }
    return null;
  }
  boltHit(pos, radius) {
    for (const e of this.list) {
      if (e.dead) continue;
      const c = e.group.position;
      const dy = e.type === 'jackling' ? 0.9 : 1.4;
      if (dist2D(pos.x, pos.z, c.x, c.z) < radius + (e.isBoss ? 3 : 0.6) &&
          Math.abs(pos.y - (c.y + dy)) < (e.isBoss ? 6 : 1.6)) return e;
    }
    return null;
  }

  applyDamage(e, dmg, point, type, crit) {
    if (e.dead) return;
    // ghosts shrug off lead unless lit by the lantern's sight
    if (e.type === 'ghost' && type === 'silver' && !e.vulnerable) {
      showToast('Lead passes through. Light it, or use witchfire.');
      return;
    }
    const mult = e.resist?.[type] ?? 1;
    // sneak attack: striking an unaware enemy hits far harder
    let sneak = 1;
    if (!e.aware && !e.isBoss) { sneak = this.player.sneakMult; e.aware = true; showToast('SNEAK ATTACK'); }
    e.hp -= dmg * mult * sneak;
    e.stagger = Math.min(0.35, 0.12 + dmg * 0.003);
    this.audio.thud(e.type === 'jackling' ? 140 : 90);
    this._spawnHitFx(point ?? e.group.position, type);
    if (e.isBoss) this._updateBossBar();
    if (e.hp <= 0) this._kill(e);
  }

  _kill(e) {
    e.dead = true; e.dyingT = e.isBoss ? 2.4 : 0.6; e.state = 'die';
    this.kills++;
    this.player.addXP(e.xp);
    if (this.factions) this.factions.onKill(e);
    if (this.warden) this.warden.onKill(e);
    if (e.onDeath) e.onDeath();
    // drop soulgilt currency
    const reward = Math.max(1, Math.round(e.xp * (e.isBoss ? 0.5 : 0.4)));
    this.player.coin = (this.player.coin || 0) + reward;
    const cn = document.getElementById('coin-n'); if (cn) cn.textContent = this.player.coin;
    if (e.isBoss) {
      this._hideBossBar();
      this.audio.bell(180);
      this.player.relieveDread(30);
      if (e.bossKind === 'engine') {
        this.engine = null; this.boss = null;
        showToast('The Harvest Engine seizes. Seventy-three Octobers of overtime, ended.');
        whisper('the foundry bell is free');
        if (this.onEngineDefeated) this.onEngineDefeated();
      } else if (e.bossKind === 'count') {
        this.count = null; this.boss = null;
        this.player.stats.aim += 2; this.player.flags && (this.player.flags.duelPistol = true);
        if (this.player.weaponsRef) { this.player.weaponsRef.ammoMax += 1; this.player.weaponsRef.ammo = this.player.weaponsRef.ammoMax; }
        if (this.factions) this.factions.modify('wardens', 10);
        this.player.addKeyItem('widowmaker', "The Widowmaker's Waltz", 'A dueling pistol that hums when music plays. (+2 Aim, +1 capacity)');
        showToast("THE WIDOWMAKER'S WALTZ — +2 Aim, +1 capacity. A pistol that hums when music plays.");
        whisper('“…well dueled. do call again.”');
        if (this.onCountDefeated) this.onCountDefeated();
      } else {
        this.boss = null;
        showToast('Marrow Jack falls. The field exhales.');
        whisper('the first bell is silenced');
        if (this.onBossDefeated) this.onBossDefeated();
      }
    }
  }

  _spawnHitFx(pos, type) {
    const col = type === 'witchfire' ? 0x9dff6a : 0xffcaa0;
    const N = 6;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { arr[i*3] = pos.x; arr[i*3+1] = pos.y; arr[i*3+2] = pos.z; }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size: 0.15, transparent: true, opacity: 1 }));
    pts.userData.vel = [];
    for (let i = 0; i < N; i++) pts.userData.vel.push(new THREE.Vector3((Math.random()-0.5)*4, Math.random()*4, (Math.random()-0.5)*4));
    pts.userData.life = 0.5;
    this.scene.add(pts);
    (this._fx ||= []).push(pts);
  }

  // Lantern Flare AoE — stuns, reveals ghosts, kills weak adds.
  flareBurst(center, radius) {
    for (const e of this.list) {
      if (e.dead) continue;
      const d = dist2D(center.x, center.z, e.group.position.x, e.group.position.z);
      if (d < radius) {
        e.stagger = 1.4;
        if (e.type === 'ghost') { e.vulnerable = true; e.vulnTimer = 6; this.applyDamage(e, 30, e.group.position, 'witchfire', false); }
        else if (e.type === 'jackling') this.applyDamage(e, 30, e.group.position, 'witchfire', false);
        else this.applyDamage(e, 14, e.group.position, 'witchfire', false);
      }
    }
  }

  // Vine Snare — root + slow everything in an area.
  snare(center, radius, duration) {
    let n = 0;
    for (const e of this.list) {
      if (e.dead) continue;
      if (dist2D(center.x, center.z, e.group.position.x, e.group.position.z) < radius) {
        e.stagger = Math.max(e.stagger, duration);
        if (!e.isBoss) { e.snaredSpeed = e.snaredSpeed ?? e.speed; e.speed = e.snaredSpeed * 0.25; e.unsnareT = duration; }
        n++;
      }
    }
    return n;
  }

  // Pumpkin-bomb area damage.
  areaDamage(center, radius, dmg, type) {
    for (const e of this.list) {
      if (e.dead) continue;
      const d = dist2D(center.x, center.z, e.group.position.x, e.group.position.z);
      if (d < radius) this.applyDamage(e, dmg * (1 - d / radius * 0.5), e.group.position, type, false);
    }
  }

  spawnExplosion(pos, radius) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, radius, 24),
      new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, this.world.getHeight(pos.x, pos.z) + 0.2, pos.z);
    this.scene.add(ring);
    (this._rings ||= []).push({ mesh: ring, life: 0.4 });
  }

  // ---------- per-frame ----------
  update(dt) {
    const p = this.player.pos;
    this.camera = this.player.camera;
    this.player.camera.getWorldDirection(this._camForward);

    // boss trigger
    if (!this.bossTriggered && this.world.bossArena) {
      const a = this.world.bossArena;
      if (dist2D(p.x, p.z, a.x, a.z) < a.r) this.spawnBoss(a.x, a.z);
    }
    // Ashfall Harvest Engine trigger
    if (!this.engineTriggered && !this.player.interior) {
      const reg = this.world.regionAt(p.x, p.z);
      if (reg.id === 'ashfall' && dist2D(p.x, p.z, reg.x, reg.z) < 38) this.spawnHarvestEngine(reg.x + 14, reg.z + 10);
    }

    // ambient spawns
    this._ambientSpawn(dt);

    let nearDread = 0, anyAware = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      this._think(e, dt, p);
      const d = dist2D(p.x, p.z, e.group.position.x, e.group.position.z);
      if (!e.dead && e.aware && !e.isBoss && d < 60) anyAware = true;
      if (!e.dead && d < 14) nearDread += e.dread * (1 - d / 14);
      // despawn far ambient (not boss)
      if (!e.isBoss && !e.dead && d > 130) this._deregister(e);
    }
    this.player.detected = anyAware;
    // proximity feeds Dread
    if (nearDread > 0) this.player.addDread(nearDread * dt * 6);

    // hit fx
    if (this._fx) {
      for (let i = this._fx.length - 1; i >= 0; i--) {
        const f = this._fx[i]; f.userData.life -= dt;
        const pos = f.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const v = f.userData.vel[k];
          pos.setXYZ(k, pos.getX(k) + v.x * dt, pos.getY(k) + v.y * dt, pos.getZ(k) + v.z * dt);
          v.y -= 9 * dt;
        }
        pos.needsUpdate = true;
        f.material.opacity = Math.max(0, f.userData.life * 2);
        if (f.userData.life <= 0) { this.scene.remove(f); f.geometry.dispose(); this._fx.splice(i, 1); }
      }
    }
    // explosion rings
    if (this._rings) {
      for (let i = this._rings.length - 1; i >= 0; i--) {
        const r = this._rings[i]; r.life -= dt;
        r.mesh.scale.multiplyScalar(1 + dt * 2);
        r.mesh.material.opacity = Math.max(0, r.life * 1.5);
        if (r.life <= 0) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); this._rings.splice(i, 1); }
      }
    }
  }

  _ambientSpawn(dt) {
    if (this.suspended || this.player.wakeGraceT > 0) return;
    this.spawnCd -= dt;
    const danger = this.world.danger || 1;
    const cap = Math.round(this.maxAmbient * danger);
    const alive = this.list.filter(e => !e.dead && !e.isBoss).length;
    if (this.spawnCd > 0 || alive >= cap) return;
    this.spawnCd = randRange(Math.random, 1.6, 3.4) / danger;
    const p = this.player.pos;
    const reg = this.world.regionAt(p.x, p.z);
    // spawn just out of comfortable view
    const a = Math.random() * TAU, r = randRange(Math.random, 34, 52);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (dist2D(x, z, 0, 0) < 60) return; // keep the start village calm around the well

    const roll = Math.random();
    if (reg.id === 'mournwood') {
      if (roll < 0.32) this.spawnGhost(x, z);
      else if (roll < 0.55) this.spawnWerebeast(x, z);
      else if (roll < 0.82) this.spawnScarecrow(x, z);
      else this.spawnJackling(x, z);
    } else if (reg.id === 'gallowsfen') {
      if (roll < 0.55) this.spawnGhost(x, z);
      else if (roll < 0.82) this.spawnScarecrow(x, z);
      else this.spawnJackling(x, z);
    } else if (reg.id === 'jackfield' || reg.id === 'thousand') {
      if (roll < 0.5) this.spawnScarecrow(x, z);
      else if (roll < 0.85) this.spawnJackling(x, z);
      else this.spawnGhost(x, z);
    } else if (reg.id === 'ashfall') {
      if (roll < 0.45) this.spawnDoll(x, z);
      else if (roll < 0.7) this.spawnGhost(x, z);
      else if (roll < 0.9) this.spawnScarecrow(x, z);
      else this.spawnJackling(x, z);
    } else {
      // Gravewick / Candlewick — townsfolk monsters incl. parlor vampires
      if (roll < 0.32) this.spawnScarecrow(x, z);
      else if (roll < 0.55) this.spawnJackling(x, z);
      else if (roll < 0.78) this.spawnGhost(x, z);
      else this.spawnParlorLeech(x, z);
    }
  }

  _isWatched(e) {
    // angle between camera forward and direction to enemy
    const c = e.group.position;
    const toE = new THREE.Vector3(c.x - this.player.pos.x, 0, c.z - this.player.pos.z).normalize();
    const fwd = new THREE.Vector3(this._camForward.x, 0, this._camForward.z).normalize();
    return toE.dot(fwd) > 0.5;
  }

  _faceAndStep(e, dt, p, stop = false) {
    const c = e.group.position;
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz) || 1;
    e.group.rotation.y = Math.atan2(dx, dz);
    if (!stop && d > e.atkRange * 0.8) {
      const sp = e.speed * (e.stagger > 0 ? 0.3 : 1) * dt;
      const step = Math.min(sp, d - e.atkRange * 0.7);
      c.x += (dx / d) * step;
      c.z += (dz / d) * step;
    }
    return d;
  }

  _think(e, dt, p) {
    e.stagger = Math.max(0, e.stagger - dt);
    if (e.vulnTimer) { e.vulnTimer -= dt; if (e.vulnTimer <= 0) e.vulnerable = false; }
    if (e.unsnareT) { e.unsnareT -= dt; if (e.unsnareT <= 0 && e.snaredSpeed != null) { e.speed = e.snaredSpeed; e.snaredSpeed = null; } }

    if (e.state === 'die') {
      e.dyingT -= dt;
      e.group.position.y -= dt * (e.isBoss ? 1.5 : 2.5);
      e.group.rotation.z += dt * 2;
      e.group.scale.multiplyScalar(1 - dt * (e.isBoss ? 0.4 : 1.2));
      if (e.dyingT <= 0) this._deregister(e);
      return;
    }

    // keep grounded
    const gy = this.world.getHeight(e.group.position.x, e.group.position.z);

    // ---- stealth: unaware enemies idle until they detect you ----
    if (!e.aware && !e.isBoss) {
      if (this._detect(e, p)) { e.aware = true; e.alertedT = 0.4; }
      else { this._idle(e, dt, gy); return; }
    }

    if (e.type === 'scarecrow') {
      const watched = this._isWatched(e);
      const d = dist2D(p.x, p.z, e.group.position.x, e.group.position.z);
      // freeze when watched (unless adjacent — then it lunges)
      const adjacent = d < e.atkRange + 0.5;
      this._faceAndStep(e, dt, p, watched && !adjacent || e.stagger > 0);
      e.group.position.y = gy;
      // twitchy head tilt
      e.head.rotation.z = Math.sin(performance.now() * 0.005 + e.id) * 0.25;
      this._tryAttack(e, dt, p, d, watched ? 0 : 0);
    }
    else if (e.type === 'jackling') {
      const d = this._faceAndStep(e, dt, p, e.stagger > 0);
      e.group.position.y = gy + e.hover + Math.sin(performance.now() * 0.008 + e.id) * 0.18;
      this._tryAttack(e, dt, p, d);
    }
    else if (e.type === 'doll') {
      const d = this._faceAndStep(e, dt, p, e.stagger > 0);
      e.hopPhase += dt * 16;
      e.group.position.y = gy + Math.abs(Math.sin(e.hopPhase)) * (e.isMother ? 0.1 : 0.28);
      e.group.rotation.x = Math.sin(e.hopPhase) * 0.2;   // scrabbling tilt
      this._tryAttack(e, dt, p, d);
      if (e.isMother) {
        e.addCd -= dt;
        if (e.addCd <= 0) {
          e.addCd = 4;
          const dolls = this.list.filter(x => !x.dead && x.type === 'doll' && !x.isMother).length;
          if (dolls < 7) {
            const a = Math.random() * TAU;
            this.spawnDoll(e.group.position.x + Math.cos(a) * 2.5, e.group.position.z + Math.sin(a) * 2.5);
          }
        }
      }
    }
    else if (e.type === 'werebeast') {
      const d = this._faceAndStep(e, dt, p, e.stagger > 0);
      e.group.position.y = gy + Math.abs(Math.sin(performance.now() * 0.012 + e.id)) * 0.12;
      this._tryAttack(e, dt, p, d);
    }
    else if (e.type === 'leech') {
      const d = this._faceAndStep(e, dt, p, e.stagger > 0);
      e.group.position.y = gy + Math.sin(performance.now() * 0.004 + e.id) * 0.12;
      const bit = this._tryAttack(e, dt, p, d);
      if (bit && e.drains) e.hp = Math.min(e.maxHp, e.hp + 8); // drains life
    }
    else if (e.type === 'ghost') {
      e.phaseT += dt;
      // ghosts drift, fade in/out; only solid (vulnerable) when in lantern light
      const litBySight = this.player.lanternOn &&
        dist2D(p.x, p.z, e.group.position.x, e.group.position.z) < 12 && this._isWatched(e);
      if (litBySight) { e.vulnerable = true; e.vulnTimer = 0.5; }
      e.mat.opacity = e.vulnerable ? 0.7 : 0.22 + Math.sin(e.phaseT * 2) * 0.08;
      const d = this._faceAndStep(e, dt, p, e.stagger > 0);
      e.group.position.y = gy + Math.sin(e.phaseT) * 0.3 + 0.2;
      this._tryAttack(e, dt, p, d);
    }
    else if (e.type === 'boss') {
      if (e.bossKind === 'count') this._countThink(e, dt, p, gy);
      else this._bossThink(e, dt, p, gy);
    }
  }

  _countThink(e, dt, p, gy) {
    e.group.position.y = gy;
    const d = this._faceAndStep(e, dt, p, e.stagger > 0);
    e.group.rotation.y = Math.atan2(p.x - e.group.position.x, p.z - e.group.position.z);
    e.face.rotation.y = Math.sin(performance.now() * 0.003) * 0.3;
    this._tryAttack(e, dt, p, d);

    const frac = e.hp / e.maxHp;
    if (frac < 0.66 && e.phase === 1) { e.phase = 2; this.audio.bossRoar(); whisper('“then we dance with the help”'); }
    if (frac < 0.33 && e.phase === 2) { e.phase = 3; this.audio.bossRoar(); whisper('“if you will not bow, you will SHATTER”'); e.speed = 9; }

    // elegant dash toward the player
    e.dashCd -= dt;
    if (e.dashCd <= 0 && d > 5) {
      e.dashCd = e.phase >= 3 ? 1.6 : 3;
      const dir = new THREE.Vector3(p.x - e.group.position.x, 0, p.z - e.group.position.z).normalize();
      e.group.position.x += dir.x * 4; e.group.position.z += dir.z * 4;
    }

    // phase 2+: summon blood-servants
    if (e.phase >= 2) {
      e.addCd -= dt;
      if (e.addCd <= 0) {
        e.addCd = e.phase >= 3 ? 5 : 7;
        const leeches = this.list.filter(x => !x.dead && x.type === 'leech').length;
        if (leeches < 6) {
          const a = Math.random() * TAU;
          this.spawnParlorLeech(e.group.position.x + Math.cos(a) * 4, e.group.position.z + Math.sin(a) * 4, true);
        }
      }
    }
    // phase 3: shatter into porcelain copies that rush you
    if (e.phase >= 3 && !e._shattered) {
      e._shattered = true;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        const c = this.spawnParlorLeech(e.group.position.x + Math.cos(a) * 3, e.group.position.z + Math.sin(a) * 3, true);
        c.hp = c.maxHp = 24; c.speed = 9.5; c.dmg = 12;
      }
    }
  }

  // can this enemy notice the player right now?
  _detect(e, p) {
    const d = dist2D(p.x, p.z, e.group.position.x, e.group.position.z);
    if (d < 2.8) return true;                       // right on top of it
    const range = e.aggro * (0.45 + this.player.noise * 0.95);
    if (d > range) return false;
    // in front of the enemy is easier to spot; behind it relies on noise
    const toP = new THREE.Vector3(p.x - e.group.position.x, 0, p.z - e.group.position.z).normalize();
    const fwd = new THREE.Vector3(Math.sin(e.group.rotation.y), 0, Math.cos(e.group.rotation.y));
    const facing = toP.dot(fwd) > -0.2;
    return facing || this.player.noise > 0.5;
  }

  // wander quietly near home until alerted
  _idle(e, dt, gy) {
    e._idleT = (e._idleT || 0) - dt;
    if (e._idleT <= 0) { e._idleT = 2 + Math.random() * 3.5; e._idleDir = Math.random() * TAU; }
    const sp = e.speed * 0.16 * dt;
    const nx = e.group.position.x + Math.cos(e._idleDir) * sp;
    const nz = e.group.position.z + Math.sin(e._idleDir) * sp;
    if (dist2D(nx, nz, e.homeX, e.homeZ) < 9) { e.group.position.x = nx; e.group.position.z = nz; }
    e.group.rotation.y = e._idleDir;
    let hover = 0;
    if (e.type === 'jackling') hover = e.hover + Math.sin(performance.now() * 0.006 + e.id) * 0.15;
    else if (e.type === 'ghost') { hover = 0.2 + Math.sin(performance.now() * 0.002) * 0.2; if (e.mat) e.mat.opacity = 0.18; }
    else if (e.type === 'doll') hover = Math.abs(Math.sin(performance.now() * 0.006 + e.id)) * 0.1;
    e.group.position.y = this.world.getHeight(e.group.position.x, e.group.position.z) + hover;
  }

  // a gunshot / loud spell / flare wakes everything nearby
  alert(pos, radius) {
    for (const e of this.list) {
      if (e.dead || e.aware) continue;
      if (dist2D(pos.x, pos.z, e.group.position.x, e.group.position.z) < radius) e.aware = true;
    }
  }

  _tryAttack(e, dt, p, d) {
    e.atkCd = Math.max(0, e.atkCd - dt);
    if (this.player.wakeGraceT > 0) return false;
    if (d <= e.atkRange && e.atkCd <= 0 && e.stagger <= 0) {
      e.atkCd = 1.4;
      this.player.damage(e.dmg, e.type);
      // Bramble Skin perk: attackers take recoil damage
      if (this.player.thornMail > 0 && !e.dead) { e.hp -= this.player.thornMail; if (e.hp <= 0) this._kill(e); }
      // little lunge
      const dir = new THREE.Vector3(p.x - e.group.position.x, 0, p.z - e.group.position.z).normalize();
      e.group.position.x += dir.x * 0.3; e.group.position.z += dir.z * 0.3;
      return true;
    }
    return false;
  }

  _bossThink(e, dt, p, gy) {
    e.group.position.y = gy;
    const d = this._faceAndStep(e, dt, p, e.stagger > 0);
    e.group.rotation.y = Math.atan2(p.x - e.group.position.x, p.z - e.group.position.z);
    e.headGrp.rotation.y += dt * 0.6;

    // phase transitions
    const frac = e.hp / e.maxHp;
    if (frac < 0.66 && e.phase === 1) { e.phase = 2; this.audio.bossRoar(); whisper('it plants the field with fire'); }
    if (frac < 0.33 && e.phase === 2) { e.phase = 3; this.audio.bossRoar(); whisper('the root-heart shrieks'); e.speed = 4.5; }

    // melee scythe sweep
    this._tryAttack(e, dt, p, d);

    // spawn adds (crows = jacklings)
    e.addCd -= dt;
    if (e.addCd <= 0 && e.phase >= 1) {
      e.addCd = e.phase >= 3 ? 4 : 6;
      const alive = this.list.filter(x => !x.dead && x.type === 'jackling').length;
      if (alive < 8) {
        const a = Math.random() * TAU;
        this.spawnJackling(e.group.position.x + Math.cos(a) * 4, e.group.position.z + Math.sin(a) * 4);
      }
    }

    // pumpkin bombs in phase 2+
    if (e.phase >= 2) {
      e.bombCd -= dt;
      if (e.bombCd <= 0) {
        e.bombCd = e.phase >= 3 ? 2.2 : 3.4;
        this._pumpkinBomb(p.x + randRange(Math.random,-4,4), p.z + randRange(Math.random,-4,4));
      }
    }
  }

  _pumpkinBomb(x, z) {
    const y = this.world.getHeight(x, z);
    const warn = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.7, 20),
      new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    warn.rotation.x = -Math.PI / 2; warn.position.set(x, y + 0.1, z);
    this.scene.add(warn);
    const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xd2691e, emissive: 0x661a00, emissiveIntensity: 1 }));
    bomb.position.set(x, y + 6, z); this.scene.add(bomb);
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      bomb.position.y = y + 6 - t * t * 9;
      warn.material.opacity = 0.4 + Math.abs(Math.sin(t * 10)) * 0.5;
      if (bomb.position.y <= y + 0.4) {
        // detonate
        this.scene.remove(bomb); this.scene.remove(warn);
        bomb.geometry.dispose(); warn.geometry.dispose();
        this.audio.thud(60); this.audio.bossRoar();
        if (dist2D(this.player.pos.x, this.player.pos.z, x, z) < 2.4) this.player.damage(22, 'pumpkin');
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _updateBossBar() {
    const fl = document.getElementById('boss-fill');
    if (fl && this.boss) fl.style.width = `${clamp(this.boss.hp / this.boss.maxHp, 0, 1) * 100}%`;
  }
}
