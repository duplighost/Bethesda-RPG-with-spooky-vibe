// ============================================================
// interiors.js — enterable interior dungeons with a diegetic
// load-fade. Interiors are enclosed cells built far from the
// overworld; crossing a threshold fades to black, swaps the
// player into the cell, and the fog gaslights the seams.
//
//  · Bellweather House — a combat haunt; the boss is the house's
//    grief itself (a Grief Wraith) guarding the Mourning Key.
//  · Old Mother Grin's Hut — a social encounter; bargain, fight,
//    or get baked into a pie.
// ============================================================
import * as THREE from 'three';
import { dist2D, showToast, whisper } from './utils.js';

const CEIL = 0x140f12;

export class Interiors {
  constructor(scene, world, player, enemies, audio, dialogue, npcs) {
    this.scene = scene; this.world = world; this.player = player;
    this.enemies = enemies; this.audio = audio; this.dialogue = dialogue; this.npcs = npcs;
    this.active = null;          // current interior id
    this.built = {};             // cached built cells
    this.fadeEl = document.getElementById('fade');
    this.fadeText = document.getElementById('fade-text');
    this._fading = false;

    // exterior doors → which interior they open (placed at building doorways)
    this.doors = [
      { x: -70, z: 70, r: 3.5, id: 'bellweather', label: 'enter · The Bellweather House' },
      { x: -300, z: 180, r: 3.5, id: 'grinhut', label: "enter · Old Mother Grin's Hut" },
      { x: -360, z: -240, r: 4, id: 'toyworks', label: 'enter · Harrow & Sons Toyworks' },
      { x: 96, z: -89, r: 4, id: 'candlemanor', label: 'enter · Candlewick Manor' },
    ];
    // align door triggers to the actual doorway (front wall, world space)
    this._placeDoors();
  }

  _placeDoors() {
    // Bellweather is rotated ~0.15 rad, door on -z face; nudge trigger outward.
    const b = this.doors[0];
    b.x = -70 + Math.sin(Math.PI * 0.15) * 6.3;
    b.z = 70 - Math.cos(Math.PI * 0.15) * 6.3;
    const g = this.doors[1];
    g.x = -300 + Math.sin(0.7) * 3.8;
    g.z = -300 + 180; // keep near hut; coarse trigger radius covers it
    g.x = -300; g.z = 180 - 3.8;
  }

  // ---------------- interaction provider ----------------
  nearest(p) {
    if (this._fading || this.dialogue.active) return null;
    if (this.active) {
      // inside: look for exit + interior interactables
      const cell = this.built[this.active];
      let best = null, bd = Infinity;
      for (const it of cell.interactables) {
        if (it.used) continue;
        const d = dist2D(p.x, p.z, it.pos.x, it.pos.z);
        if (d < (it.radius || 3) && d < bd) { bd = d; best = it; }
      }
      if (!best) return null;
      return { pos: best.pos, prompt: best.prompt, run: () => best.run() };
    }
    // outside: doors
    let best = null, bd = Infinity;
    for (const d of this.doors) {
      const dd = dist2D(p.x, p.z, d.x, d.z);
      if (dd < d.r && dd < bd) { bd = dd; best = d; }
    }
    if (!best) return null;
    return { pos: new THREE.Vector3(best.x, p.y, best.z), prompt: best.label, run: () => this.enter(best.id) };
  }

  // ---------------- fade helper ----------------
  _fade(text, midCb, after = 900) {
    if (this._fading) return;
    this._fading = true;
    this.fadeText.textContent = text || '';
    this.fadeEl.classList.add('on');
    setTimeout(() => {
      midCb && midCb();
      setTimeout(() => {
        this.fadeEl.classList.remove('on');
        this._fading = false;
      }, after);
    }, after);
  }

  // ---------------- enter / exit ----------------
  enter(id) {
    const whispers = {
      bellweather: 'the door is behind you now',
      grinhut: 'something in the kitchen sets a thirteenth plate',
    };
    this._fade(whispers[id] || '', () => {
      this._exteriorReturn = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw };
      const cell = this._buildOrGet(id);
      this.active = id;
      this.enemies.suspended = true;
      this.player.interior = { floorY: cell.floorY, colliders: cell.colliders, min: cell.min, max: cell.max };
      this.player.spawnAt(cell.spawn.x, cell.spawn.z, cell.spawn.yaw);
      this.world.setInteriorMuted(true);
      this.scene.fog.color.setHex(0x07060a);
      this.scene.fog.density = 0.03;
      document.getElementById('region-name').textContent = cell.name;
      cell.onEnter && cell.onEnter();
      this.audio.ghostHiss();
    });
  }

  exit() {
    this._fade('you step back into the wind', () => {
      this.active = null;
      this.enemies.suspended = false;
      this.player.interior = null;
      this.world.setInteriorMuted(false);
      const r = this._exteriorReturn;
      // step out a couple metres so you don't instantly re-trigger the door
      this.player.spawnAt(r.x, r.z, r.yaw + Math.PI);
      this.scene.fog.density = 0.0065;
      this.scene.fog.color.setHex(this.world.regionAt(r.x, r.z).fog);
    });
  }

  _buildOrGet(id) {
    if (this.built[id]) { this.built[id].group.visible = true; return this.built[id]; }
    const base = { x: 6000 + Object.keys(this.built).length * 400, z: 6000 };
    const cell = id === 'bellweather' ? this._bellweather(base)
      : id === 'toyworks' ? this._toyworks(base)
      : id === 'candlemanor' ? this._candlemanor(base)
      : this._grinhut(base);
    this.built[id] = cell;
    return cell;
  }

  // ---------------- shared room builder ----------------
  _room(base, w, d, h, fogColor = CEIL) {
    const group = new THREE.Group();
    this.scene.add(group);
    const colliders = [];
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2128, roughness: 1 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), floorMat);
    floor.position.set(base.x, -0.2, base.z); floor.receiveShadow = true; group.add(floor);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), new THREE.MeshStandardMaterial({ color: fogColor, roughness: 1 }));
    ceil.position.set(base.x, h, base.z); group.add(ceil);
    const mkWall = (cx, cz, ww, dd) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, h, dd), wallMat);
      m.position.set(cx, h / 2, cz); m.receiveShadow = true; group.add(m);
      colliders.push({ minX: cx - ww / 2, maxX: cx + ww / 2, minZ: cz - dd / 2, maxZ: cz + dd / 2 });
    };
    mkWall(base.x, base.z - d / 2, w, 0.5);
    mkWall(base.x, base.z + d / 2, w, 0.5);
    mkWall(base.x - w / 2, base.z, 0.5, d);
    mkWall(base.x + w / 2, base.z, 0.5, d);
    return { group, colliders, floorMat };
  }

  _interiorLight(group, x, z, color, intensity, dist) {
    const L = new THREE.PointLight(color, intensity, dist, 2);
    L.position.set(x, 2.4, z); group.add(L);
    return L;
  }

  _note(cell, x, z, title, body) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd8c89a, emissive: 0x4a3c1c, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2.2; m.position.set(x, 0.9, z); cell.group.add(m);
    const L = new THREE.PointLight(0xffd070, 0.4, 3, 2); L.position.set(x, 1.4, z); cell.group.add(L);
    cell.interactables.push({
      pos: new THREE.Vector3(x, 0.9, z), radius: 3, prompt: `read · ${title}`, used: false,
      run: () => { this._openReader(title, body); this.player.addXP(8); },
    });
  }

  _openReader(title, body) {
    document.getElementById('reader-title').textContent = title;
    document.getElementById('reader-body').textContent = body;
    document.getElementById('reader').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.onReaderOpen) this.onReaderOpen();
  }

  _exitObject(cell, x, z) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x120c08, emissive: 0x1a0e06, emissiveIntensity: 0.3 }));
    door.position.set(x, 1.3, z); cell.group.add(door);
    const L = new THREE.PointLight(0x6fa0ff, 0.7, 4, 2); L.position.set(x, 2, z); cell.group.add(L);
    cell.interactables.push({
      pos: new THREE.Vector3(x, 1.3, z), radius: 3, prompt: 'leave', used: false,
      run: () => this.exit(),
    });
  }

  // ---------------- Bellweather House ----------------
  _bellweather(base) {
    const W = 22, D = 18, H = 4.5;
    const { group, colliders } = this._room(base, W, D, H, 0x0c0810);
    const cell = { id: 'bellweather', name: 'THE BELLWEATHER HOUSE', group, colliders,
      floorY: 0, min: { x: base.x - W / 2 + 1, z: base.z - D / 2 + 1 }, max: { x: base.x + W / 2 - 1, z: base.z + D / 2 - 1 },
      spawn: { x: base.x, z: base.z + D / 2 - 2, yaw: Math.PI }, interactables: [], cleared: false };

    // dining table set for thirteen
    const table = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 1 }));
    table.position.set(base.x, 0.9, base.z - 2); group.add(table);
    const ashMat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, emissive: 0x111111, roughness: 1 });
    let idx = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 6; i++) {
        const cx = base.x - 3 + i * 1.2, cz = base.z - 2 + side * 1.5;
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x241813 }));
        chair.position.set(cx, 0.6, cz); group.add(chair);
        if (idx < 12) {
          const fig = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 8), ashMat);
          fig.position.set(cx, 1.5, cz - side * 0.1); group.add(fig);
        }
        idx++;
      }
    }
    // the empty thirteenth chair, cold light over it
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x1c120d }));
    head.position.set(base.x + 4, 0.8, base.z - 2); group.add(head);
    this._interiorLight(group, base.x + 4, base.z - 2, 0x6fa0ff, 0.9, 7);

    // ambient warm hearths so it's readable
    this._interiorLight(group, base.x - W / 2 + 2, base.z + D / 2 - 2, 0xff8a3a, 1.2, 12);
    this._interiorLight(group, base.x + W / 2 - 2, base.z - D / 2 + 2, 0xff7a1e, 1.0, 12);

    // basement ritual circle of wedding rings (a glowing ring decal)
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.3, 40),
      new THREE.MeshBasicMaterial({ color: 0xe8c46a, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(base.x - 6, 0.05, base.z + 4); group.add(ring);

    this._note(cell, base.x - 6, base.z + 4, 'Bellweather Family Journal',
`We could not let the chair stay empty.
Mother set his place every supper, and one by one
the guests we invited took his sickness, his silence,
and his seat — and gave us back one more night of "almost."
Twelve guests. Twelve silhouettes of ash.
The grief learned our faces. Now it sets the table itself.`);

    this._exitObject(cell, base.x, base.z + D / 2 - 1.2);

    // mini-boss: the house's grief, woken when you near the empty chair
    cell.onEnter = () => {
      if (cell.cleared || cell.wraith) return;
      showToast('The twelfth candle gutters. Something pulls out the thirteenth chair.');
      whisper('“sit. you’re just in time.”');
      setTimeout(() => {
        const e = this.enemies.spawnGhost(base.x + 4, base.z - 2);
        e.hp = e.maxHp = 320; e.speed = 5.2; e.dmg = 20; e.xp = 220; e.dread = 0.7;
        e.group.scale.setScalar(1.8);
        e.isGrief = true;
        e.onDeath = () => this._bellweatherCleared(cell, base);
        cell.wraith = e;
        this.audio.bossRoar();
      }, 1400);
    };
    return cell;
  }

  _bellweatherCleared(cell, base) {
    cell.cleared = true;
    showToast('The grief lets go. The thirteenth chair is finally empty.');
    whisper('the house exhales decades of held breath');
    this.player.relieveDread(40);
    // The Mourning Key reward
    const key = new THREE.Mesh(new THREE.OctahedronGeometry(0.3),
      new THREE.MeshStandardMaterial({ color: 0xe8c46a, emissive: 0xe8c46a, emissiveIntensity: 0.6 }));
    key.position.set(base.x + 4, 1.0, base.z - 2); cell.group.add(key);
    const L = new THREE.PointLight(0xe8c46a, 1.0, 5, 2); L.position.copy(key.position); cell.group.add(L);
    cell.interactables.push({
      pos: key.position.clone(), radius: 3, prompt: 'take · The Mourning Key', used: false,
      run: () => {
        cell.group.remove(key); cell.group.remove(L);
        this.player.stats.wits += 2; this.player.addXP(60);
        this.audio.pickup();
        showToast('THE MOURNING KEY — +2 Wits. It opens doors where someone died waiting.');
        if (this.player.flags) this.player.flags.mourningKey = true;
      },
    });
  }

  // ---------------- Old Mother Grin's Hut ----------------
  _grinhut(base) {
    const W = 14, D = 14, H = 4.2;
    const { group, colliders } = this._room(base, W, D, H, 0x0a1008);
    const cell = { id: 'grinhut', name: "OLD MOTHER GRIN'S KITCHEN", group, colliders,
      floorY: 0, min: { x: base.x - W / 2 + 1, z: base.z - D / 2 + 1 }, max: { x: base.x + W / 2 - 1, z: base.z + D / 2 - 1 },
      spawn: { x: base.x, z: base.z + D / 2 - 2, yaw: Math.PI }, interactables: [], done: false };

    // green witchfire hearth + hanging pots
    this._interiorLight(group, base.x, base.z - 3, 0x6dff5a, 1.6, 16);
    this._interiorLight(group, base.x - W / 2 + 2, base.z + 2, 0xff7a1e, 0.8, 10);
    const cauldron = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x14110d, metalness: 0.4, roughness: 0.7 }));
    cauldron.position.set(base.x, 0.6, base.z - 3); group.add(cauldron);
    const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.2, 12),
      new THREE.MeshBasicMaterial({ color: 0x6dff5a }));
    brew.position.set(base.x, 1.15, base.z - 3); group.add(brew);
    colliders.push({ minX: base.x - 1, maxX: base.x + 1, minZ: base.z - 4, maxZ: base.z - 2 });

    // a long table of pies
    const table = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12 }));
    table.position.set(base.x + 3, 0.9, base.z + 2); group.add(table);
    for (let i = 0; i < 4; i++) {
      const pie = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: 0x6b4a22, roughness: 1 }));
      pie.position.set(base.x + 1.5 + i * 1, 1.05, base.z + 2); group.add(pie);
    }

    // Old Mother Grin herself (an NPC body, but driven by interior dialogue)
    const grin = new THREE.Group();
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.7, 8),
      new THREE.MeshStandardMaterial({ color: 0x1c241c, roughness: 1, flatShading: true }));
    cloak.position.y = 0.85; grin.add(cloak);
    const ghead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa07a, roughness: 1 }));
    ghead.position.y = 1.9; grin.add(ghead);
    grin.position.set(base.x, 0, base.z - 1.5); group.add(grin);

    this._note(cell, base.x - 4, base.z + 3, "Old Mother Grin's Recipe",
`Take one bad dream, still warm. Fold in the guilt of the dreamer.
Bake until the house forgets it was ever a person.
I have baked two hundred years and never gone hungry.`);

    this._exitObject(cell, base.x, base.z + D / 2 - 1.2);

    // talk-to-Grin interactable
    cell.interactables.push({
      pos: new THREE.Vector3(base.x, 1, base.z - 1.5), radius: 3.2, prompt: 'speak · Old Mother Grin',
      get used() { return false; }, set used(_) {},
      run: () => this._grinTalk(cell),
    });
    return cell;
  }

  _grinTalk(cell) {
    this.dialogue.open(GRIN_TREE, {
      cell, audio: this.audio, interiors: this,
      onClose: () => { if (this.onReaderClose) this.onReaderClose(); },
    });
    if (this.onDialogueOpen) this.onDialogueOpen();
  }

  grinReward(kind) {
    if (kind === 'spellbook') {
      this.player.stats.hex += 3; this.player.addXP(80);
      showToast('Forbidden Harvestcraft — +3 Hex. Your witchfire burns greener.');
    } else if (kind === 'adopt') {
      this.player.maxHP += 30; this.player.hp = this.player.maxHP; this.player.addXP(60);
      showToast('“Eat. You’re skin and curses.” +30 max Vitality.');
    }
  }
  grinFight(cell) {
    const base = { x: cell.group.children[0].position.x, z: cell.group.children[0].position.z };
    for (let i = 0; i < 3; i++) {
      const e = this.enemies.spawnGhost(base.x + (i - 1) * 2, base.z - 3);
      e.hp = e.maxHp = 120; e.dmg = 16; e.xp = 60;
    }
    const w = this.enemies.spawnWerebeast(base.x, base.z - 3);
    w.hp = w.maxHp = 200; w.xp = 140;
    showToast('“Rude.” The knives wake up.');
    this.audio.bossRoar();
  }

  // ---------------- Harrow & Sons Toyworks ----------------
  _toyworks(base) {
    const W = 26, D = 18, H = 5;
    const { group, colliders } = this._room(base, W, D, H, 0x0a0808);
    const cell = { id: 'toyworks', name: 'HARROW & SONS TOYWORKS', group, colliders,
      floorY: 0, min: { x: base.x - W / 2 + 1, z: base.z - D / 2 + 1 }, max: { x: base.x + W / 2 - 1, z: base.z + D / 2 - 1 },
      spawn: { x: base.x, z: base.z + D / 2 - 2, yaw: Math.PI }, interactables: [], cleared: false };

    // grim red work-light + a cold one
    this._interiorLight(group, base.x - 6, base.z, 0xff3a1e, 1.3, 16);
    this._interiorLight(group, base.x + 7, base.z - 4, 0x6fa0ff, 0.7, 12);

    // the assembly line — a long conveyor of dark steel, still running
    const belt = new THREE.Mesh(new THREE.BoxGeometry(18, 0.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x14110d, metalness: 0.5, roughness: 0.6 }));
    belt.position.set(base.x, 0.9, base.z + 1); group.add(belt);
    colliders.push({ minX: base.x - 9, maxX: base.x + 9, minZ: base.z + 0.2, maxZ: base.z + 1.8 });
    // half-built dolls riding the belt
    for (let i = 0; i < 9; i++) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.4 }));
      h.position.set(base.x - 8 + i * 2, 1.25, base.z + 1); group.add(h);
    }
    // dolls hung from the ceiling on strings
    for (let i = 0; i < 10; i++) {
      const x = base.x - 10 + Math.random() * 20, z = base.z - D / 2 + 1.5 + Math.random() * 4;
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2, 3),
        new THREE.MeshStandardMaterial({ color: 0x222018 }));
      str.position.set(x, H - 1, z); group.add(str);
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.5 }));
      d.position.set(x, H - 2, z); group.add(d);
    }

    this._note(cell, base.x - 9, base.z + 4, 'Harrow & Sons — Quality Control',
`Each doll is stuffed to specification: one lock of hair, one milk-tooth,
one secret the customer swore they'd take to the grave.
We do not ask where Mother sources the secrets.
We have stopped asking where Mother sources the children.
The line runs three shifts. Mother runs all three.`);

    this._exitObject(cell, base.x, base.z + D / 2 - 1.2);

    cell.onEnter = () => {
      if (cell.cleared || cell.mother) return;
      showToast('The line shudders. Something enormous unfolds off its hook.');
      whisper('“playtime. i made you a friend. i made you ALL my friends.”');
      setTimeout(() => {
        for (let i = 0; i < 3; i++) this.enemies.spawnDoll(base.x - 2 + i * 2, base.z - 2);
        const m = this.enemies.spawnDoll(base.x, base.z - 4, true);
        m.onDeath = () => this._toyworksCleared(cell, base);
        cell.mother = m;
        this.audio.bossRoar();
      }, 1200);
    };
    return cell;
  }

  // ---------------- Candlewick Manor (Porcelain Count) ----------------
  _candlemanor(base) {
    const W = 24, D = 20, H = 6;
    const { group, colliders } = this._room(base, W, D, H, 0x0c0810);
    const cell = { id: 'candlemanor', name: 'CANDLEWICK MANOR', group, colliders,
      floorY: 0, min: { x: base.x - W / 2 + 1, z: base.z - D / 2 + 1 }, max: { x: base.x + W / 2 - 1, z: base.z + D / 2 - 1 },
      spawn: { x: base.x, z: base.z + D / 2 - 2, yaw: Math.PI }, interactables: [], cleared: false };

    // a grand ballroom: chandelier glows + a long carpet
    for (const cx of [-6, 0, 6]) {
      this._interiorLight(group, base.x + cx, base.z, 0xffd9a0, 0.9, 12);
      const chand = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xffd9a0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      chand.scale.setScalar(2.4); chand.position.set(base.x + cx, H - 1, base.z); group.add(chand);
    }
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, D - 2),
      new THREE.MeshStandardMaterial({ color: 0x4a0d18, roughness: 1 }));
    carpet.position.set(base.x, 0.03, base.z); group.add(carpet);
    // portraits along one wall (emissive faces that "watch")
    for (let i = 0; i < 5; i++) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x1a140e }));
      frame.position.set(base.x - 8 + i * 4, 3, base.z - D / 2 + 0.3); group.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0),
        new THREE.MeshBasicMaterial({ color: 0xb06adf, transparent: true, opacity: 0.35 }));
      face.position.set(base.x - 8 + i * 4, 3, base.z - D / 2 + 0.36); group.add(face);
    }

    this._note(cell, base.x - 8, base.z + 5, 'A Calling Card, Embossed',
`The Count receives at midnight and at midnight only.
He has been thirty-nine years old for one hundred and ten years.
The porcelain is not a mask. The porcelain is what is left
when you replace a man, piece by piece, with the price of staying.
Do not accept the wine. Do not compliment the portraits.
Do not, under any roof of his, stop moving.`);

    this._exitObject(cell, base.x, base.z + D / 2 - 1.2);

    cell.onEnter = () => {
      if (cell.cleared || cell.boss) return;
      whisper('the doors lock behind you with a sound like applause');
      setTimeout(() => {
        const c = this.enemies.spawnPorcelainCount(base.x, base.z - 4);
        c.onDeath = () => { cell.cleared = true; cell.boss = null; };
        this.enemies.onCountDefeated = () => { whisper('the manor is yours, if you want a house that remembers being a man'); };
        cell.boss = c;
      }, 1000);
    };
    return cell;
  }

  _toyworksCleared(cell, base) {
    cell.cleared = true;
    showToast('The Doll-Mother comes apart into a hundred quiet faces.');
    whisper('the line finally stops');
    this.player.maxWisp += 25; this.player.wisp = this.player.maxWisp; this.player.addXP(120);
    this.player.stats.tinker = (this.player.stats.tinker || 0) + 1;
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a1a2a, emissive: 0x3a0a14, emissiveIntensity: 0.6 }));
    spool.position.set(base.x, 1.0, base.z - 4); cell.group.add(spool);
    cell.interactables.push({
      pos: spool.position.clone(), radius: 3, prompt: "take · Mother's Spool", used: false,
      run: () => { cell.group.remove(spool); this.audio.pickup();
        showToast("MOTHER'S SPOOL — +25 max Wisp. It is warm, and it is someone's hair."); },
    });
  }
}

const GRIN_TREE = {
  start: {
    speaker: 'Old Mother Grin',
    text: "Mm. You smell like a long pig who fired a silver gun. Sit, sit. The kettle's been on two hundred years. What does the Wickmarked want from an old woman with flour on her hands and worse beneath the nails?",
    options: [
      { label: 'Teach me the old Harvestcraft.', goto: 'teach' },
      { label: 'Why do you bake people’s nightmares?', goto: 'why' },
      { label: '[Monster Lore] Those pies are moving.', check: { stat: 'lore', dc: 5 }, goto: 'caught', fail: { goto: 'why' } },
      { label: '(Draw on her.)', goto: 'fight' },
      { label: '(Leave.)', end: true },
    ],
  },
  teach: {
    speaker: 'Old Mother Grin',
    text: "Hungry for power and only one supper old. I like that. A page, then — but pages have a price, and I do so love company at the table.",
    options: [
      { label: '[Hex] Pay in your own craft, not your blood.', check: { stat: 'hex', dc: 6 },
        action: (c) => c.interiors.grinReward('spellbook'), end: true,
        fail: { goto: 'priceblood' } },
      { label: 'Let her feed you first.', action: (c) => c.interiors.grinReward('adopt'), goto: 'teach2' },
      { label: '(Back.)', goto: 'start' },
    ],
  },
  teach2: {
    speaker: 'Old Mother Grin',
    text: "There. Now the page. Don't read the last line aloud until you mean it. And do visit. Loops are lonely for those who remember them.",
    options: [{ label: '(Take the page.)', action: (c) => c.interiors.grinReward('spellbook'), end: true }],
  },
  priceblood: {
    speaker: 'Old Mother Grin',
    text: "Then blood it is — but not today. You'd taste of panic and that ruins the crust. Come back when you've something worth braising.",
    options: [{ label: '(Leave.)', end: true }],
  },
  why: {
    speaker: 'Old Mother Grin',
    text: "Because someone must hold the county's bad dreams, dearie, or they curdle into something with teeth. I am the larder. Better in my pies than loose in your fields. You're welcome, by the way. No one ever says it.",
    options: [{ label: '(Back.)', goto: 'start' }],
  },
  caught: {
    speaker: 'Old Mother Grin',
    text: "...Sharp eyes. Most don't look twice at supper. Yes, they squirm. Yes, they remember. No, you don't want to know whose. Take a page and go, before your curiosity earns you a crust of your own.",
    options: [
      { label: 'Take the page and go.', action: (c) => c.interiors.grinReward('spellbook'), end: true },
      { label: '(Draw on her.)', goto: 'fight' },
    ],
  },
  fight: {
    speaker: 'Old Mother Grin',
    text: "Rude. And after I set you a place.",
    options: [{ label: '(Fight!)', action: (c) => c.interiors.grinFight(c.cell), end: true }],
  },
};
