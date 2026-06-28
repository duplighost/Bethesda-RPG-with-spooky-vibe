// ============================================================
// npc.js — living townsfolk: talkable NPCs with branching
// dialogue, the Mask Market vendor (shop + soulgilt currency),
// and the recruitable companion Mara Vale who fights at your side.
// ============================================================
import * as THREE from 'three';
import { dist2D, clamp, showToast, whisper } from './utils.js';

// ---- a simple cloaked humanoid ----
function buildBody(palette) {
  const g = new THREE.Group();
  const cloak = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: palette.cloak, roughness: 1, flatShading: true })
  );
  cloak.position.y = 0.75; cloak.castShadow = true; g.add(cloak);
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: palette.coat, roughness: 1 })
  );
  torso.position.y = 1.35; g.add(torso);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 12),
    new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.9 })
  );
  head.position.y = 1.85; head.castShadow = true; g.add(head);
  if (palette.hat) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 1 }));
    brim.position.y = 1.98; g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.32, 10),
      new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 1 }));
    top.position.y = 2.15; g.add(top);
  }
  if (palette.mask) {
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 12),
      new THREE.MeshStandardMaterial({ color: palette.mask, emissive: palette.mask, emissiveIntensity: 0.25, roughness: 0.5 }));
    mask.scale.z = 0.5; mask.position.set(0, 1.86, 0.12); g.add(mask);
  }
  // a soft lantern glow at the belt so NPCs read at night (sprite = free)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    color: palette.glow ?? 0xffb060, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.setScalar(1.6); glow.position.y = 1.3; g.add(glow);
  return g;
}

export class NPCs {
  constructor(scene, world, player, audio, dialogue, enemies, quests) {
    this.scene = scene; this.world = world; this.player = player;
    this.audio = audio; this.dialogue = dialogue; this.enemies = enemies; this.quests = quests;
    this.list = [];
    this.companion = null;
    this.shopOpen = false;
    if (this.player.coin === undefined) this.player.coin = 0;
    this._build();
    this._wireShop();
  }

  _add(def) {
    const group = buildBody(def.palette);
    group.position.set(def.x, this.world.getHeight(def.x, def.z), def.z);
    this.scene.add(group);
    const npc = { ...def, group, homeX: def.x, homeZ: def.z, wt: Math.random() * 5, dead: false };
    this.list.push(npc);
    return npc;
  }

  _build() {
    // Deputy Holloway — survived too many Octobers; gossip + a side bounty.
    this._add({
      name: 'Deputy Holloway', kind: 'talk', x: 14, z: 4,
      palette: { cloak: 0x223040, coat: 0x2c3c50, skin: 0xc89a78, hat: 0x14181f },
      tree: HOLLOWAY,
    });
    // Mara Vale — Lantern Warden, recruitable companion.
    this._add({
      name: 'Mara Vale', kind: 'talk', x: -6, z: -40,
      palette: { cloak: 0x3a2018, coat: 0x52301c, skin: 0xd0a886, hat: 0x1c120c, glow: 0xff8a3a },
      tree: MARA, recruitable: true,
    });
    // The Masked Trader — Mask Market vendor.
    this._add({
      name: 'The Masked Trader', kind: 'vendor', x: -16, z: 8,
      palette: { cloak: 0x2a1430, coat: 0x3a1c44, skin: 0x000000, mask: 0xb06adf, glow: 0xb06adf },
      tree: null,
    });
  }

  // ---------- interaction provider ----------
  nearest(p) {
    if (this.dialogue.active || this.shopOpen) return null;
    let best = null, bd = Infinity;
    for (const n of this.list) {
      if (n.dead || n.recruited) continue;
      const d = dist2D(p.x, p.z, n.group.position.x, n.group.position.z);
      if (d < 3 && d < bd) { bd = d; best = n; }
    }
    if (!best) return null;
    return {
      pos: best.group.position,
      prompt: `talk · ${best.name}`,
      run: () => this._talk(best),
    };
  }

  _talk(npc) {
    this.audio.pickup();
    if (npc.kind === 'vendor') { this.openShop(npc); return; }
    this.dialogue.open(npc.tree, {
      npc, npcs: this, quests: this.quests, audio: this.audio,
      onClose: () => { if (this.onDialogueClose) this.onDialogueClose(); },
    });
    if (this.onDialogueOpen) this.onDialogueOpen();
  }

  recruit(npc) {
    npc.recruited = true;
    this.companion = npc;
    npc.fireCd = 0;
    document.getElementById('companion-status').classList.remove('hidden');
    document.getElementById('companion-name').textContent = npc.name;
    showToast(`${npc.name} joins you.`);
    whisper('“i’ve got your back. mostly.”');
  }

  // ---------- currency / shop ----------
  addCoin(n) {
    this.player.coin += n;
    document.getElementById('coin-n').textContent = this.player.coin;
  }

  _wireShop() {
    this.shopEl = document.getElementById('shop');
    this.SHOP = [
      { id: 'broth', name: 'Bonebroth Flask', desc: 'Restores all Vitality.', cost: 15,
        buy: (pl) => { pl.hp = pl.maxHP; } },
      { id: 'wisp', name: 'Wisp Draught', desc: 'Restores all Wisp.', cost: 10,
        buy: (pl) => { pl.wisp = pl.maxWisp; } },
      { id: 'silver', name: 'Silver Cylinder Mod', desc: '+1 revolver capacity (permanent).', cost: 45,
        buy: (pl) => { pl.weaponsRef.ammoMax += 1; pl.weaponsRef.ammo = pl.weaponsRef.ammoMax; } },
      { id: 'grit', name: "Warden's Tonic", desc: '+1 Grit (permanent).', cost: 70,
        buy: (pl) => { pl.stats.grit += 1; } },
      { id: 'hex', name: 'Shard of Hexglass', desc: '+1 Hex (permanent).', cost: 70,
        buy: (pl) => { pl.stats.hex += 1; } },
      { id: 'ward', name: 'Salt-Ward Charm', desc: 'Relieves all Dread now.', cost: 20,
        buy: (pl) => { pl.relieveDread(100); } },
    ];
  }

  openShop() {
    this.shopOpen = true;
    this.audio.pickup();
    this.shopEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.onDialogueOpen) this.onDialogueOpen();
    this._renderShop();
  }
  closeShop() {
    this.shopOpen = false;
    this.shopEl.classList.add('hidden');
    if (this.onDialogueClose) this.onDialogueClose();
  }
  _renderShop() {
    document.getElementById('shop-coin-n').textContent = this.player.coin;
    const box = document.getElementById('shop-items');
    box.innerHTML = '';
    for (const it of this.SHOP) {
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `<div class="info"><b>${it.name}</b><small>${it.desc}</small></div>`;
      const btn = document.createElement('button');
      btn.className = 'shop-buy';
      btn.textContent = `◉ ${it.cost}`;
      btn.disabled = this.player.coin < it.cost;
      btn.onclick = () => {
        if (this.player.coin < it.cost) return;
        this.addCoin(-it.cost);
        it.buy(this.player);
        this.audio.bell(440);
        showToast(`Bought ${it.name}`);
        this._renderShop();
      };
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  // ---------- per-frame ----------
  update(dt) {
    const p = this.player.pos;
    for (const n of this.list) {
      if (n.dead) continue;
      if (n === this.companion) { this._companionTick(n, dt, p); continue; }
      // idle wander near home, but always turn to face the player when close
      n.wt += dt;
      const d = dist2D(p.x, p.z, n.group.position.x, n.group.position.z);
      if (d < 5) {
        n.group.rotation.y = Math.atan2(p.x - n.group.position.x, p.z - n.group.position.z);
      } else {
        const a = n.wt * 0.4;
        const tx = n.homeX + Math.cos(a) * 2.5, tz = n.homeZ + Math.sin(a) * 2.5;
        const dx = tx - n.group.position.x, dz = tz - n.group.position.z;
        const dd = Math.hypot(dx, dz) || 1;
        n.group.position.x += (dx / dd) * dt * 0.7;
        n.group.position.z += (dz / dd) * dt * 0.7;
        n.group.rotation.y = Math.atan2(dx, dz);
      }
      n.group.position.y = this.world.getHeight(n.group.position.x, n.group.position.z) +
        Math.abs(Math.sin(n.wt * 2)) * 0.04;
    }
  }

  _companionTick(n, dt, p) {
    // follow at a trailing offset
    const off = new THREE.Vector3(Math.sin(this.player.yaw + 0.6), 0, Math.cos(this.player.yaw + 0.6)).multiplyScalar(2.4);
    const tx = p.x - off.x, tz = p.z - off.z;
    const dx = tx - n.group.position.x, dz = tz - n.group.position.z;
    const dd = Math.hypot(dx, dz);
    if (dd > 1.2) {
      const sp = clamp(dd, 0, 8) * dt * 1.4;
      n.group.position.x += (dx / dd) * sp;
      n.group.position.z += (dz / dd) * sp;
    }
    // teleport if left far behind (e.g., after fast travel / interior)
    if (dd > 40) n.group.position.set(tx, this.world.getHeight(tx, tz), tz);
    n.group.position.y = this.world.getHeight(n.group.position.x, n.group.position.z);

    // shoot nearest enemy
    n.fireCd -= dt;
    let target = null, bd = 28;
    for (const e of this.enemies.list) {
      if (e.dead) continue;
      const d = dist2D(n.group.position.x, n.group.position.z, e.group.position.x, e.group.position.z);
      if (d < bd) { bd = d; target = e; }
    }
    if (target) {
      n.group.rotation.y = Math.atan2(target.group.position.x - n.group.position.x, target.group.position.z - n.group.position.z);
      if (n.fireCd <= 0) {
        n.fireCd = 1.1;
        this._tracer(n.group.position, target.group.position);
        this.audio.gunshot();
        this.enemies.applyDamage(target, 14 + this.player.level, target.group.position, 'silver', false);
      }
    }
    // companion HP readout (uses player-relative flavour; she is unkillable for simplicity)
    document.getElementById('companion-hp').textContent = target ? '⚔' : '·';
  }

  _tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y + 1.3, from.z),
      new THREE.Vector3(to.x, to.y + 1.2, to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    setTimeout(() => { this.scene.remove(line); geo.dispose(); }, 70);
  }
}

// ================= dialogue trees =================
const HOLLOWAY = {
  start: {
    speaker: 'Deputy Holloway',
    text: "You've got grave-dirt on your collar and a lantern where your hand should be. Wickmarked. Figures. Every October you people wash up.",
    options: [
      { label: 'What is happening to this county?', goto: 'lore' },
      { label: "You've seen this before?", goto: 'loop' },
      { label: '[Presence] Deputize me. I can help.', check: { stat: 'presence', dc: 5 },
        action: (c, pl) => { c.npcs.addCoin(40); showToast('Holloway tosses you 40 soulgilt and a tin star.'); },
        goto: 'deputized', fail: { goto: 'nope' } },
      { label: '(Leave.)', end: true },
    ],
  },
  lore: {
    speaker: 'Deputy Holloway',
    text: "The Long October. Same four weeks on a loop, and each turn the land forgets a little more of how to be ordinary. The bells hold it in place. Thirteen of them. Somebody keeps ringing.",
    options: [
      { label: 'Where do I start?', action: (c) => { showToast('Marker set: east, into Jackfield Acres.'); }, goto: 'start' },
      { label: '(Back.)', goto: 'start' },
    ],
  },
  loop: {
    speaker: 'Deputy Holloway',
    text: "Seen it? I keep arresting the same man. Tall fella, smells of cider and lye. Books him every loop for what he did at the Bellweather place. He's started to remember me between the resets. Doesn't like that I do too.",
    options: [
      { label: '[Monster Lore] He isn’t a man anymore, is he?', check: { stat: 'lore', dc: 4 },
        action: () => whisper('“no. he stopped being one a long time ago.”'), goto: 'start',
        fail: { goto: 'start' } },
      { label: '(Back.)', goto: 'start' },
    ],
  },
  deputized: {
    speaker: 'Deputy Holloway',
    text: "Don't make me regret it. Anything wearing a mask after the thirteenth bell is fair game. Anything wearing a face it didn't grow — that too.",
    options: [{ label: '(Nod.)', end: true }],
  },
  nope: {
    speaker: 'Deputy Holloway',
    text: "Hah. You couldn't talk a scarecrow out of a cornfield. Go earn the look first.",
    options: [{ label: '(Leave.)', end: true }],
  },
};

const MARA = {
  start: {
    speaker: 'Mara Vale',
    text: (c, pl) => pl.lanternOn
      ? "Lantern's lit. Good. Keeps the ones that aren't supposed to be there honest. I'm Mara — Lantern Warden, what's left of the chapter."
      : "Light that thing before you talk to me. I don't trust a face I can only half see.",
    options: (c, pl) => [
      { label: 'Who are the Lantern Wardens?', goto: 'wardens' },
      { label: 'You hunt these things alone?', goto: 'brother' },
      { label: 'Watch my back out there. Come with me.', goto: 'recruit',
        hide: () => false },
      { label: '(Leave.)', end: true },
    ],
  },
  wardens: {
    speaker: 'Mara Vale',
    text: "Exorcists with rifles and not enough funding. We break curses where we can and put down what we can't. We've put down a few things that were still mostly people. I don't sleep much.",
    options: [{ label: '(Back.)', goto: 'start' }],
  },
  brother: {
    speaker: 'Mara Vale',
    text: "Not always alone. My brother walks the tree-line some nights, waving like he used to. Trouble is I buried him two loops back. A witch pulled me out of the marsh once; maybe she left a window open in my head. Maybe he's really out there. I haven't decided which is worse.",
    options: [
      { label: '[Hex] He’s real. The marsh keeps what it takes.', check: { stat: 'hex', dc: 6 },
        action: () => whisper('something in the dark exhales, relieved'),
        goto: 'start', fail: { goto: 'start' } },
      { label: '(Back.)', goto: 'start' },
    ],
  },
  recruit: {
    speaker: 'Mara Vale',
    text: "You're going to walk into the worst rooms in the county regardless. Fine. I'll shoot the things you miss. Don't get cute, don't get cursed, don't get me killed.",
    options: [
      { label: 'Deal.', action: (c) => c.npcs.recruit(c.npc), end: true },
      { label: 'On second thought…', goto: 'start' },
    ],
  },
};
