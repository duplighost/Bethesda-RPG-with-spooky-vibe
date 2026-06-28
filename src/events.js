// ============================================================
// events.js — handcrafted dynamic world encounters (not radiant
// oatmeal). Each is a small, memorable roadside vignette.
//   · The Crying Bride — directions to a church that burned down.
//   · The Whispering Sack — it knows your name. Open it?
//   · The Scarecrow That Moved — closer every time you look away.
// ============================================================
import * as THREE from 'three';
import { dist2D, randRange, TAU, showToast, whisper } from './utils.js';

export class Events {
  constructor(scene, world, player, audio, dialogue, enemies) {
    this.scene = scene; this.world = world; this.player = player;
    this.audio = audio; this.dialogue = dialogue; this.enemies = enemies;
    this.events = [];
    this._build();
  }

  _build() {
    this._bride();
    this._sack();
    this._movingScarecrow();
  }

  // ---- The Crying Bride ----
  _bride() {
    const x = 165, z = -64;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.4,
      emissive: 0x4a5a80, emissiveIntensity: 0.7, depthWrite: false });
    const gown = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.0, 12, 1, true), mat);
    gown.position.y = 1.1; g.add(gown);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), mat);
    head.position.y = 2.15; g.add(head);
    const veil = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }));
    veil.position.y = 2.1; g.add(veil);
    const L = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0x9fb6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    L.scale.setScalar(2.2); L.position.y = 1.4; g.add(L);
    g.position.set(x, this.world.getHeight(x, z), z);
    this.scene.add(g);
    this.events.push({ id: 'bride', x, z, r: 9, group: g, mesh: head, triggered: false, auto: true,
      run: () => this._brideTalk(g) });
  }

  _brideTalk(g) {
    this.dialogue.open(BRIDE_TREE, {
      events: this, audio: this.audio, brideGroup: g,
      onClose: () => { if (this.onDialogueClose) this.onDialogueClose(); },
    });
    if (this.onDialogueOpen) this.onDialogueOpen();
  }

  brideVanish(g) {
    this.player.relieveDread(15); this.player.addXP(30);
    this.audio.ghostHiss();
    g.traverse(o => { if (o.material) { o.material.transparent = true; } });
    g.userData.fade = 1;
  }
  brideWail(g) {
    this.player.addDread(25); this.audio.ghostHiss();
    whisper('“you weren’t at the wedding either”');
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * TAU;
      this.enemies.spawnGhost(g.position.x + Math.cos(a) * 4, g.position.z + Math.sin(a) * 4);
    }
  }

  // ---- The Whispering Sack ----
  _sack() {
    const x = -120, z = 96;
    const sack = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.6, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 1 })
    );
    sack.position.set(x, this.world.getHeight(x, z) + 0.55, z);
    sack.rotation.z = 0.4; this.scene.add(sack);
    this.events.push({ id: 'sack', x, z, r: 2.6, group: sack, triggered: false, auto: false,
      prompt: 'open · a burlap sack (it is whispering)',
      run: () => this._openSack(sack) });
  }
  _openSack(sack) {
    this.scene.remove(sack);
    if (Math.random() < 0.5) {
      const coin = 35 + Math.floor(Math.random() * 30);
      this.player.coin += coin;
      const cn = document.getElementById('coin-n'); if (cn) cn.textContent = this.player.coin;
      this.audio.pickup();
      showToast(`Inside: ${coin} soulgilt and a child's tooth. The whispering stops.`);
    } else {
      whisper('it was your name, after all');
      this.audio.ghostHiss();
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU;
        this.enemies.spawnJackling(sack.position.x + Math.cos(a) * 2, sack.position.z + Math.sin(a) * 2);
      }
      this.player.addDread(15);
      showToast('The sack was full of teeth and spite.');
    }
  }

  // ---- The Scarecrow That Moved ----
  _movingScarecrow() {
    const x = 250, z = 30;
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
    post.position.y = 1.3; g.add(post);
    const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
    arms.rotation.z = Math.PI / 2; arms.position.y = 1.9; g.add(arms);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xc7a85a, roughness: 1, flatShading: true }));
    head.position.y = 2.15; head.scale.y = 1.2; g.add(head);
    const em = new THREE.MeshBasicMaterial({ color: 0xff3010 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), em); e1.position.set(-0.1, 2.18, 0.22); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.1; g.add(e2);
    g.position.set(x, this.world.getHeight(x, z), z);
    this.scene.add(g);
    this.events.push({ id: 'movecrow', x, z, r: 3.2, group: g, triggered: false, auto: true, creeps: true,
      run: () => this._scarecrowWakes(g) });
  }
  _scarecrowWakes(g) {
    this.scene.remove(g);
    whisper('it was never a scarecrow');
    this.audio.bossRoar();
    const e = this.enemies.spawnScarecrow(g.position.x, g.position.z);
    e.hp = e.maxHp = 90; e.xp = 40;
    this.player.addDread(12);
  }

  // ---- interaction provider (the sack) ----
  nearest(p) {
    if (this.dialogue.active) return null;
    for (const ev of this.events) {
      if (ev.auto || ev.triggered) continue;
      const d = dist2D(p.x, p.z, ev.group.position.x, ev.group.position.z);
      if (d < ev.r) {
        return { pos: ev.group.position, prompt: ev.prompt, run: () => { ev.triggered = true; ev.run(); } };
      }
    }
    return null;
  }

  update(dt) {
    if (this.player.interior) return;
    const p = this.player.pos;
    for (const ev of this.events) {
      if (ev.triggered) {
        // bride fade-out
        if (ev.group?.userData?.fade !== undefined) {
          ev.group.userData.fade -= dt * 0.6;
          ev.group.traverse(o => { if (o.material && o.material.opacity !== undefined) o.material.opacity = Math.max(0, ev.group.userData.fade * 0.4); });
          if (ev.group.userData.fade <= 0) { this.scene.remove(ev.group); }
        }
        continue;
      }
      const d = dist2D(p.x, p.z, ev.group.position.x, ev.group.position.z);
      // the scarecrow creeps closer while unwatched
      if (ev.creeps) {
        const toE = new THREE.Vector3(ev.group.position.x - p.x, 0, ev.group.position.z - p.z).normalize();
        const fwd = new THREE.Vector3(); this.player.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const watched = toE.dot(fwd) > 0.4;
        if (!watched && d < 40 && d > ev.r) {
          const step = dt * 4.5;
          ev.group.position.x += (p.x - ev.group.position.x) / d * step;
          ev.group.position.z += (p.z - ev.group.position.z) / d * step;
          ev.group.position.y = this.world.getHeight(ev.group.position.x, ev.group.position.z);
        }
        ev.group.rotation.y = Math.atan2(p.x - ev.group.position.x, p.z - ev.group.position.z);
      }
      if (ev.auto && d < ev.r) { ev.triggered = true; ev.run(); }
      // gentle bob/sway for the bride
      if (ev.id === 'bride' && ev.mesh) ev.group.position.y = this.world.getHeight(ev.group.position.x, ev.group.position.z) + Math.sin(performance.now() * 0.002) * 0.1;
    }
  }
}

const BRIDE_TREE = {
  start: {
    speaker: 'A Weeping Bride',
    text: "Oh — oh, thank goodness, a face. Please. I'm so late. Which way to Saint Lumen's? The ceremony's started without me, I can hear the bells, but the road keeps... folding.",
    options: [
      { label: '[Presence] Gently: there is no ceremony. Not for sixty years.', check: { stat: 'presence', dc: 6 },
        action: (c) => c.events.brideVanish(c.brideGroup), end: true,
        fail: { goto: 'insist' } },
      { label: '[Hex] Look at her properly, with the lantern-sight.', check: { stat: 'hex', dc: 5 }, goto: 'truth',
        fail: { goto: 'insist' } },
      { label: 'Point her up the road. (Lie.)', goto: 'wail' },
      { label: '(Back away slowly.)', end: true },
    ],
  },
  insist: {
    speaker: 'A Weeping Bride',
    text: "No — no, you're wrong, listen, the bells, they're ringing right now. He's waiting. He promised he'd wait. Why does everyone look at me like that?",
    options: [
      { label: 'The church burned. He didn’t wait. I’m sorry.', goto: 'wail' },
      { label: '(Leave her to the road.)', end: true },
    ],
  },
  truth: {
    speaker: 'A Weeping Bride',
    text: "...You see it. The veil, the burn under it. Yes. The fire took the chapel and everyone kind enough to be inside. I keep walking to a wedding that is only ash. If you ever pass Saint Lumen's — leave a flower on the step. That's all. That's enough.",
    options: [
      { label: 'I will. Rest now.', action: (c) => c.events.brideVanish(c.brideGroup), end: true },
    ],
  },
  wail: {
    speaker: 'A Weeping Bride',
    text: "LIAR. You're like the rest of them. You weren't at the wedding. NOBODY CAME.",
    options: [
      { label: '(Brace yourself.)', action: (c) => c.events.brideWail(c.brideGroup), end: true },
    ],
  },
};
