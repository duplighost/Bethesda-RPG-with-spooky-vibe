// ============================================================
// items.js — interactables: readable notes (the Bethesda
// environmental-storytelling backbone), loot pickups, and the
// quest-flag objects. Press E when the prompt shows.
// ============================================================
import * as THREE from 'three';
import { dist2D, clamp, showToast, whisper } from './utils.js';

// Hand-written notes scattered across the county. Each is a tiny tragedy.
export const NOTES = [
  { x: 0, z: -52, title: "Embalmer's Last Ledger", region: 'gravewick', body:
`Intake, Hallow's Eve. The boy from the Bellweather plot.
No pulse I could find. No pulse the doctor could find.
And yet when I closed the lid he knocked. Three times. Polite.
The director says fill the order regardless. The order is thirteen.
We are at twelve.

— if you are reading this, I am sorry. You are the thirteenth.` },

  { x: -70, z: 70, title: 'Bellweather Family Journal', region: 'gravewick', body:
`We could not let the chair stay empty.
Mother set a place for him every supper, and one by one
the guests we invited took his sickness and his silence
and his seat — and gave us back one more night of "almost."
Twelve guests. Twelve silhouettes of ash.
The thirteenth chair is yours, traveler. Don't sit down.` },

  { x: 26, z: -18, title: 'Town Notice — Pinned to a Door', region: 'gravewick', body:
`BY ORDER OF THE COUNTY:
Doors are to be answered before the bell tolls thirteen.
Candy is to be kept by every hearth.
The Trick-or-Treater is owed. The Trick-or-Treater remembers.
Do NOT refuse the child with no shadow.` },

  { x: 320, z: -120, title: 'Marrowbarn Farm — Soil Survey', region: 'jackfield', body:
`The pumpkins came up wrong this loop. Faces already carved
from the inside. Hired men say some faces match folks we buried.
Burned a field of them. They screamed like kettles.
Marrow Jack stood at the tree-line and watched us do it.
He has not moved in three days. He is waiting for the harvest.` },

  { x: 520, z: -300, title: 'A Banishment, Half-Remembered', region: 'thousand', body:
`The old farmhands knew his true name, and a name is a leash.
Speak it at the heart of the Thousand-Jack and the Stitched King
must kneel. Fire works too, they said, but fire makes more of him.
The name is written nowhere safe. It is written where he can't read:
on the underside of every porch pumpkin in Gravewick.` },

  { x: -300, z: 180, title: "Old Mother Grin's Recipe", region: 'mournwood', body:
`Take one bad dream, still warm.
Fold in the guilt of the dreamer. Bake until the house forgets
it was ever a person. Serve to anyone who knocks.
I have been baking two hundred years. I have never gone hungry.
You smell like a long pig who fired a silver gun. Come in, come in.` },

  { x: 60, z: 360, title: 'Drowned Mercy — Last Census', region: 'gallowsfen', body:
`The water rose the night of the First Harvest and never went down.
We climbed to the steeples. We are still up here.
If your lantern is lit you can see us waving.
Please wave back. It has been so long since anyone waved back.` },

  { x: -320, z: -260, title: 'Ashfall Works — Shift Log', region: 'ashfall', body:
`Night shift sealed in per the owner's instruction.
"For their safety," he wrote, "until the festival passes."
The festival has not passed. It has never passed.
The line still runs. We still clock in. We are owed back pay
of seventy-three Octobers. We intend to collect.` },
];

// Loot — named pickups that grant perks/stats.
export const LOOT = [
  { x: 6, z: -2, kind: 'lantern_lit', title: 'The lantern stirs',
    body: 'Press F to wake the cold moon inside it.', icon: 0xffa64d },
  { x: 30, z: 12, title: "The Gravedigger's Argument", body: '+Grit. A shovel that hates the risen.',
    icon: 0x8a8a90, grant: () => ({ stat: 'grit', amount: 2 }) },
  { x: -28, z: 18, title: 'Salt Shells (a handful)', body: 'Your revolver bites ghosts harder now.',
    icon: 0xe8e2d0, grant: () => ({ ammo: true }) },
  { x: 320, z: -120, title: 'The Jackknife', body: '+Guile. Pumpkin-stem and black iron.',
    icon: 0xff7a18, grant: () => ({ stat: 'guile', amount: 2 }) },
  { x: -300, z: 180, title: 'Forbidden Harvestcraft Page', body: '+Hex. Your witchfire burns greener.',
    icon: 0x8dff6a, grant: () => ({ stat: 'hex', amount: 3 }) },
  { x: 48, z: 332, title: "The Drowned Saint's Thimble", body: '+Presence, and the dead whisper softer. The right word lands now where the gun would not.',
    icon: 0x9fd0ff, relic: true, region: 'gallowsfen', boon: '+2 Presence, −10 Dread',
    rumor: 'In Gallowsfen they drowned a saint with her church. Her thimble surfaces in the black water when the fen runs low.',
    grant: () => ({ stat: 'presence', amount: 2, dread: -10 }) },
  { x: -306, z: -244, title: 'Union Furnace Scrip', body: '+Grit, and a fold of brass county coin.',
    icon: 0xffcf6a, relic: true, region: 'ashfall', boon: '+1 Grit, +90 Soulgilt',
    rumor: 'The pay-shacks at Ashfall Works still hold furnace-scrip — brass tokens the dead never lived to spend.',
    grant: () => ({ stat: 'grit', amount: 1, coin: 90 }) },
  { x: -288, z: 196, title: 'Moon-Splinter Lens', body: '+Instinct. The fog thins a little when you look through it.',
    icon: 0xbfe9ff, relic: true, region: 'mournwood', boon: '+2 Instinct',
    rumor: 'A lens that once caught the full moon is lost among the hanged trees of Mournwood. It still glints on clear nights.',
    grant: () => ({ stat: 'instinct', amount: 2 }) },
  { x: -66, z: 71, title: 'The Thirteenth Place Card', body: '+Wits, and the memory of a chair left empty at a long table.',
    icon: 0xd8b0ff, relic: true, region: 'gravewick', boon: '+2 Wits, +60 XP',
    rumor: 'Bellweather’s long table is laid for thirteen. Twelve seats hold ash; a place-card still waits at the empty head.',
    grant: () => ({ stat: 'wits', amount: 2, xp: 60 }) },
];

export class Items {
  constructor(scene, world, player, audio, quests) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.quests = quests;
    this.interactables = [];
    this.reading = false;
    this._build();
  }

  _build() {
    for (const n of NOTES) this._spawnNote(n);
    for (const l of LOOT) this._spawnLoot(l);
  }

  _spawnNote(n) {
    const grp = new THREE.Group();
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd8c89a, emissive: 0x4a3c1c, emissiveIntensity: 0.4, side: THREE.DoubleSide })
    );
    paper.rotation.x = -Math.PI / 2.2; grp.add(paper);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: 0xffd070, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.4); glow.position.y = 0.5; grp.add(glow);
    this.world.placeOnGround(grp, n.x + 1.5, n.z + 1.5, 0.9);
    this.scene.add(grp);
    this.interactables.push({
      pos: grp.position, label: 'read', radius: 3, kind: 'note', data: n, obj: grp, used: false,
      bob: Math.random() * 6, glow,
    });
  }

  _spawnLoot(l) {
    const grp = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({ color: l.icon, emissive: l.icon, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.4 })
    );
    mesh.position.y = 0.2; grp.add(mesh);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: l.icon, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.6); glow.position.y = 0.35; grp.add(glow);
    this.world.placeOnGround(grp, l.x, l.z, 1.0);
    this.scene.add(grp);
    const entry = {
      pos: grp.position, label: 'take', radius: 2.8, kind: 'loot', data: l, obj: grp, mesh, used: false,
      bob: Math.random() * 6, relic: !!l.relic, glow,
    };
    // Relics get a faint vertical glint that only kindles as the player draws
    // near — a findable-without-a-guide cue, not a quest marker.
    if (l.relic) {
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world._glowTex, color: l.icon, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glint.scale.setScalar(0.5); glint.position.y = 1.1; grp.add(glint);
      entry.glint = glint;
    }
    this.interactables.push(entry);
  }

  // returns the nearest usable interactable in range as {pos, prompt, run}
  nearest() {
    if (this.reading) return null;
    const p = this.player.pos;
    let best = null, bestD = Infinity;
    for (const it of this.interactables) {
      if (it.used && it.kind === 'loot') continue;
      const d = dist2D(p.x, p.z, it.pos.x, it.pos.z);
      if (d < it.radius && d < bestD) { bestD = d; best = it; }
    }
    if (!best) return null;
    return {
      pos: best.pos,
      prompt: best.kind === 'note' ? `read · ${best.data.title}` : `take · ${best.data.title}`,
      run: () => this.interact(best),
    };
  }

  interact(it) {
    if (!it) return;
    if (it.kind === 'note') {
      this._openReader(it.data.title, it.data.body);
      this.quests?.onNoteRead(it.data);
      if (!it.used) { it.used = true; this.player.addXP(8); }
    } else if (it.kind === 'loot') {
      this._takeLoot(it);
    }
  }

  _takeLoot(it) {
    const l = it.data;
    it.used = true;
    this.scene.remove(it.obj);
    this.audio.pickup();
    if (l.kind === 'lantern_lit') {
      showToast('You found your own lantern arm. Press F.');
    } else if (l.grant) {
      const g = l.grant();
      const parts = [];
      if (g.stat) {
        this.player.stats[g.stat] = (this.player.stats[g.stat] || 0) + g.amount;
        parts.push(`+${g.amount} ${g.stat.toUpperCase()}`);
      }
      if (g.ammo) {
        const w = this.player.weaponsRef;
        const bonus = g.ammo === true ? 6 : g.ammo;
        if (w) { w.ammoMax += bonus; w.ammo = w.ammoMax; }
        parts.push(`+${bonus} ammo`);
      }
      if (g.coin) { this.player.coin += g.coin; parts.push(`+${g.coin} coin`); }
      if (g.xp) { this.player.addXP(g.xp); parts.push(`+${g.xp} XP`); }
      if (g.dread) {
        this.player.dread = Math.max(0, (this.player.dread || 0) + g.dread);
        parts.push(`${g.dread > 0 ? '+' : ''}${g.dread} Dread`);
      }
      showToast(parts.length ? `${l.title} — ${parts.join(', ')}` : l.title);
    } else showToast(l.title);
    if (!this.player.collectedLoot.includes(l.title)) this.player.collectedLoot.push(l.title);
    this.quests?.onLoot(l);
  }

  // Relics surfaced in the journal: discovered ones by name+boon, the rest as cryptic rumors.
  relicStatus() {
    return this.interactables
      .filter(it => it.kind === 'loot' && it.data.relic)
      .map(it => ({ title: it.data.title, rumor: it.data.rumor, boon: it.data.boon,
                    region: it.data.region, found: !!it.used }));
  }

  // After a save is loaded, hide loot the player already collected so it can't respawn.
  syncCollected() {
    const taken = this.player.collectedLoot || [];
    for (const it of this.interactables) {
      if (it.kind === 'loot' && !it.used && taken.includes(it.data.title)) {
        it.used = true;
        this.scene.remove(it.obj);
      }
    }
  }

  _openReader(title, body) {
    this.reading = true;
    document.getElementById('reader-title').textContent = title;
    document.getElementById('reader-body').textContent = body;
    document.getElementById('reader').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeReader() {
    this.reading = false;
    document.getElementById('reader').classList.add('hidden');
  }

  update(dt) {
    const pp = this.player.pos;
    for (const it of this.interactables) {
      if (it.used && it.kind === 'loot') continue;
      it.bob += dt;
      it.obj.position.y = this.world.getHeight(it.pos.x, it.pos.z) + (it.kind === 'loot' ? 1.0 : 0.9) + Math.sin(it.bob * 2) * 0.12;
      if (it.mesh) it.mesh.rotation.y += dt * 1.5;

      // proximity glint: faint glimmer far off, kindling as the player draws near.
      // Relics get the full treatment (rising shimmer + brightening gem); lore
      // notes get a gentler glow that dims once read, so unread lore stands out.
      if (it.glow && (it.relic || it.kind === 'note')) {
        const d = dist2D(pp.x, pp.z, it.pos.x, it.pos.z);
        const near = clamp(1 - d / 46, 0, 1);           // 1 at touch → 0 by ~46 units
        const pulse = 0.78 + 0.22 * Math.sin(it.bob * 3);
        if (it.relic) {
          it.glow.material.opacity = (0.14 + near * 0.72) * pulse;
          it.glow.scale.setScalar(1.5 + near * 1.1);
          if (it.glint) {
            it.glint.material.opacity = near * near * 0.6 * pulse;   // a rising shimmer, only when close
            it.glint.scale.setScalar(0.4 + near * 0.7);
            it.glint.position.y = 1.0 + Math.sin(it.bob * 2.2) * 0.3 + near * 0.6;
          }
          if (it.mesh && it.mesh.material) it.mesh.material.emissiveIntensity = 0.45 + near * 0.9;
        } else {
          const readDim = it.used ? 0.32 : 1;            // already-read notes fade back
          it.glow.material.opacity = (0.1 + near * 0.4) * pulse * readDim;
          it.glow.scale.setScalar(1.2 + near * 0.5);
        }
      }
    }
  }
}
