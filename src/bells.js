// ============================================================
// bells.js — the Thirteen Harvest Bells (five reachable in this
// slice). Each anchor of the Long October can be Silenced, Bound,
// Given to a faction, or Fed to the curse. Your tally of choices,
// plus the curse meter and your Dread, decides which of FIVE
// endings the County Line altar grants you.
// ============================================================
import * as THREE from 'three';
import { dist2D, showToast, whisper } from './utils.js';

export class Bells {
  constructor(scene, world, player, audio, dialogue, factions, quests) {
    this.scene = scene; this.world = world; this.player = player;
    this.audio = audio; this.dialogue = dialogue; this.factions = factions; this.quests = quests;
    this.curse = 50;             // 0 = curse broken, 100 = October devours all
    this.resolved = 0;
    this.dispositions = [];      // 'silence' | 'bind' | 'give_church' | 'give_court' | 'feed'
    this.endingShown = false;
    this.altar = null;

    // five reachable bells. 'jackfield' is bound to Marrow Jack's death.
    this.list = [
      { id: 'jackfield',  name: 'The Field Bell',     x: 520, z: -300, region: 'thousand',  resolved: false, auto: true },
      { id: 'gravewick',  name: 'The Bell Beneath Town Hall', x: 4, z: -6, region: 'gravewick', resolved: false },
      { id: 'mournwood',  name: 'The Red Chapel Bell', x: -300, z: 196, region: 'mournwood', resolved: false },
      { id: 'gallowsfen', name: 'The Drowned Steeple Bell', x: 70, z: 372, region: 'gallowsfen', resolved: false },
      { id: 'ashfall',    name: 'The Foundry Bell',   x: -320, z: -250, region: 'ashfall',  resolved: false, gate: 'engine' },
    ];
    this._build();
  }

  _build() {
    for (const b of this.list) {
      if (b.auto) continue;
      b.mesh = this._bellMesh(b.x, b.z);
    }
  }

  _bellMesh(x, z) {
    const grp = new THREE.Group();
    // A-frame
    const postMat = new THREE.MeshStandardMaterial({ color: 0x241712, roughness: 1 });
    for (const sx of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.4, 6), postMat);
      post.position.set(sx, 1.7, 0); post.rotation.z = sx > 0 ? 0.25 : -0.25; grp.add(post);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), postMat);
    beam.rotation.z = Math.PI / 2; beam.position.y = 3.2; grp.add(beam);
    // bronze bell
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 1.5, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6b5224, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide, emissive: 0x1a1206, emissiveIntensity: 0.4 }));
    bell.position.y = 2.3; bell.castShadow = true; grp.add(bell);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      bell.material); cap.position.y = 3.05; grp.add(cap);
    // a cold glow sprite so it reads as an anchor
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xbf6adf, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    spr.scale.setScalar(3.5); spr.position.y = 2.3; grp.add(spr);
    grp.position.set(x, this.world.getHeight(x, z), z);
    this.scene.add(grp);
    grp.userData.bell = bell;
    return grp;
  }

  // Marrow Jack's death silences the field bell.
  onMarrowJack() {
    const b = this.list.find(x => x.id === 'jackfield');
    if (b && !b.resolved) this._apply(b, 'silence', true);
  }

  // ---- interaction provider ----
  nearest(p) {
    if (this.dialogue.active || this.endingShown) return null;
    // endgame altar
    if (this.altar) {
      const d = dist2D(p.x, p.z, this.altar.position.x, this.altar.position.z);
      if (d < 4) return { pos: this.altar.position, prompt: 'end the Long October', run: () => this._endgame() };
    }
    for (const b of this.list) {
      if (b.auto || b.resolved || !b.mesh) continue;
      if (b.gate && !this._gateOpen(b.gate)) continue;
      const d = dist2D(p.x, p.z, b.mesh.position.x, b.mesh.position.z);
      if (d < 4) return { pos: b.mesh.position, prompt: `the Harvest Bell tolls · ${b.name}`, run: () => this._choose(b) };
    }
    return null;
  }

  _gateOpen(gate) {
    if (gate === 'engine') return this._engineDead;
    return true;
  }
  setEngineDead() { this._engineDead = true; whisper('the foundry bell hangs silent and reachable now'); }

  _choose(b) {
    this.dialogue.open(makeBellTree(b), {
      bell: b, bells: this, factions: this.factions,
      onClose: () => { if (this.onDialogueClose) this.onDialogueClose(); },
    });
    if (this.onDialogueOpen) this.onDialogueOpen();
  }

  resolve(b, disposition) { this._apply(b, disposition, false); }

  _apply(b, disp, silent) {
    if (b.resolved) return;
    b.resolved = true; b.disposition = disp; this.resolved++;
    this.dispositions.push(disp);
    const F = this.factions;
    switch (disp) {
      case 'silence':
        this.curse -= 18; F.modify('wardens', 12); F.modify('church', 6); F.modify('harvest', -14);
        this.player.heal(40); this.player.relieveDread(15);
        if (!silent) showToast(`${b.name} silenced. The county breathes easier.`);
        break;
      case 'bind':
        this.curse += 4; this.player.addDread(16); F.modify('court', 6);
        { const stat = ['hex', 'aim', 'grit'][this.resolved % 3]; this.player.stats[stat] += 2;
          showToast(`${b.name} bound to your will. +2 ${stat.toUpperCase()}, but the toll lingers.`); }
        break;
      case 'give_church':
        this.curse -= 8; F.modify('church', 18); F.modify('court', -5);
        showToast(`${b.name} given to the Candle Church.`);
        break;
      case 'give_court':
        this.curse -= 4; F.modify('court', 18); F.modify('harvest', -8);
        showToast(`${b.name} given to the Grinning Court.`);
        break;
      case 'feed':
        this.curse += 22; this.player.addDread(12); F.modify('harvest', 20); F.modify('wardens', -12);
        this.player.addXP(120); this.player.stats.hex += 1;
        showToast(`${b.name} fed to the Harvest. Something vast turns over in its sleep.`);
        break;
    }
    this.curse = Math.max(0, Math.min(100, this.curse));
    this.audio.bell(disp === 'feed' ? 150 : 240);

    // open the endgame once most bells are dealt with
    if (this.resolved >= 4 && !this.altar) this._raiseAltar();
    if (this.quests) this.quests.onBellResolved?.(this.resolved, this.list.length);
  }

  _raiseAltar() {
    const x = 40, z = 840;  // the County Line, far south
    const grp = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: 1 }));
    slab.position.y = 0.5; grp.add(slab);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xbf6adf, emissive: 0xbf6adf, emissiveIntensity: 0.8 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.2; grp.add(ring);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xbf6adf, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    spr.scale.setScalar(8); spr.position.y = 2; grp.add(spr);
    grp.position.set(x, this.world.getHeight(x, z), z);
    this.scene.add(grp);
    this.altar = grp;
    showToast('THE COUNTY LINE STIRS — the fog wall at the far south has thinned.');
    whisper('the road out is also a road in');
    this.quests?.openEndgame?.();
  }

  computeEnding() {
    const d = this.dispositions;
    const count = (k) => d.filter(x => x === k).length;
    const silenced = count('silence'), bound = count('bind'), fed = count('feed');
    const given = count('give_church') + count('give_court');
    // secret: feed everything into a high-Dread, high-curse climax
    if (fed >= 3 && this.curse >= 70 && this.player.dread >= 60) return 'november';
    const scores = { break: silenced + (this.curse <= 30 ? 1 : 0), rule: bound, feed: fed + (this.curse >= 70 ? 1 : 0), seal: given };
    let best = 'seal', bv = -1;
    for (const k of ['break', 'rule', 'feed', 'seal']) if (scores[k] > bv) { bv = scores[k]; best = k; }
    return best;
  }

  _endgame() {
    if (this.endingShown) return;
    this.endingShown = true;
    const ending = this.computeEnding();
    if (this.onEnding) this.onEnding(ending, this);
  }

  serialize() {
    return { curse: this.curse, dispositions: [...this.dispositions], resolved: this.resolved,
      resolvedIds: this.list.filter(b => b.resolved).map(b => b.id), engineDead: !!this._engineDead };
  }
  load(s) {
    if (!s) return;
    this.curse = s.curse ?? 50; this.dispositions = s.dispositions || []; this.resolved = s.resolved || 0;
    this._engineDead = !!s.engineDead;
    for (const id of (s.resolvedIds || [])) {
      const b = this.list.find(x => x.id === id);
      if (b && !b.resolved) { b.resolved = true; if (b.mesh) { this.scene.remove(b.mesh); b.mesh = null; } }
    }
    if (this.resolved >= 4 && !this.altar) this._raiseAltar();
  }

  update(dt) {
    // gentle sway on the bells + altar ring spin
    const t = performance.now() * 0.001;
    for (const b of this.list) {
      if (b.mesh && b.mesh.userData.bell) b.mesh.userData.bell.rotation.z = Math.sin(t + b.x) * 0.04;
    }
    if (this.altar) this.altar.children[1].rotation.z += dt * 0.6;
  }
}

// build the per-bell choice dialogue
function makeBellTree(bell) {
  return {
    start: {
      speaker: bell.name,
      text: "The bell hangs in air gone thick as syrup. It has not been struck in this loop — but it remembers every hand that ever reached for it. The choice is yours, Wickmarked. A bell is a door, and a door swings both ways.",
      options: [
        { label: 'Silence it. Break this anchor of the curse.', action: (c) => c.bells.resolve(c.bell, 'silence'), end: true },
        { label: '[Hex] Bind its toll to my own will.', check: { stat: 'hex', dc: 5 },
          action: (c) => c.bells.resolve(c.bell, 'bind'), end: true,
          fail: { goto: 'weak' } },
        { label: 'Give it to the Candle Church.', action: (c) => c.bells.resolve(c.bell, 'give_church'), end: true },
        { label: 'Give it to the Grinning Court.', action: (c) => c.bells.resolve(c.bell, 'give_court'), end: true },
        { label: 'Feed it to the Harvest. Let October grow.', action: (c) => c.bells.resolve(c.bell, 'feed'), end: true },
        { label: '(Not yet. Step back.)', end: true },
      ],
    },
    weak: {
      speaker: bell.name,
      text: "Your Hex is too thin to hold a thing this old. The toll would bind YOU instead. Choose another way.",
      options: [
        { label: 'Silence it instead.', action: (c) => c.bells.resolve(c.bell, 'silence'), end: true },
        { label: 'Feed it to the Harvest.', action: (c) => c.bells.resolve(c.bell, 'feed'), end: true },
        { label: '(Step back.)', end: true },
      ],
    },
  };
}

// ---- ending copy ----
export const ENDINGS = {
  break: {
    title: 'BREAK THE CURSE',
    body: `You silence the last anchor and the Long October finally exhales.\n\nThe fog peels back from the County Line. Ghosts you never met walk out into a grey, ordinary dawn and simply… stop. The pumpkins go quiet. Hallow County becomes a smaller, sadder, more human place — a town that buries its dead and means it.\n\nMara lowers her rifle for the first time in years. "Huh," she says. "November."`,
  },
  rule: {
    title: 'RULE THE CURSE',
    body: `You kept every toll for yourself, and the bells answer only to you now.\n\nHallow County stays haunted — but it is YOUR haunting. October bends to your laws. The scarecrows kneel. The Grinning Court bows, because monsters always recognise a bigger one.\n\nYou are the new Lord of October, lantern-handed on a throne of cold bronze. The loop will never end. It simply belongs to you.`,
  },
  feed: {
    title: 'FEED THE CURSE',
    body: `You fed the bells to the Harvest and the Harvest said thank you.\n\nOctober pours over the County Line like floodwater. The pumpkin fields march. The dead rise grinning. It is horrible and it is glorious and it does not stop at the county road, or the next one, or the sea.\n\nSomewhere under it all, something enormous opens an eye made of candlelight, and is pleased with its gardener.`,
  },
  seal: {
    title: 'SEAL THE COUNTY',
    body: `You gave the bells to those who could hold the line, and chose the hardest mercy.\n\nThe County Line closes — not opened, but SEALED, with you and the curse on the inside and the rest of the world safe on the outside. The fog wall sets like glass.\n\nChildren a county over will tell stories about the lantern-handed wanderer in the grey, who could have left, and stayed so that they wouldn't have to. A myth. A warden. A door, locked from within.`,
  },
  november: {
    title: 'THE REAL NOVEMBER',
    body: `You broke it wrong.\n\nThe curse was never the wound — it was the bandage. With the last bell fed and your Dread a roaring tide, the Long October finally ends… and what waits underneath it was never Halloween at all.\n\nNovember arrives. Not the month. The thing the month was hiding. The pumpkins were load-bearing, and you have pulled them out, and the sky comes down soft and final and very, very cold.\n\n(secret ending)`,
  },
};
