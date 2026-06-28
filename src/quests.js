// ============================================================
// quests.js — the main-quest spine: "The First Harvest Bell."
// A light objective chain that reacts to where you go, what you
// read, and what you kill. Drives the HUD objective line.
// ============================================================
import { dist2D, showToast, whisper } from './utils.js';
import { REGIONS } from './world.js';

export class Quests {
  constructor(world, player, audio) {
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.step = 0;
    this.flags = { lanternUsed: false, ledgerRead: false, nameFound: false, bossDead: false };
    this.visited = new Set();
    this.steps = [
      { text: 'Wake. Light the lantern fused to your hand — press F.',
        done: () => this.player.lanternOn },
      { text: 'Read the embalmer’s ledger by the funeral home (north of the well).',
        done: () => this.flags.ledgerRead },
      { text: 'Hallow’s Eve repeats. Leave Gravewick — head east into Jackfield Acres.',
        done: () => this.visited.has('jackfield') },
      { text: 'Find Marrow Jack’s true name. The farmers hid it where he cannot read.',
        done: () => this.flags.nameFound },
      { text: 'Silence the first Harvest Bell: face Marrow Jack at the Thousand-Jack.',
        done: () => this.flags.bossDead },
      { text: 'One bell silenced. Twelve remain. Break the county, rule it, or feed it.',
        done: () => false },
    ];
  }

  set(text) { document.getElementById('objective-text').textContent = text; }

  start() {
    this.set(this.steps[0].text);
    setTimeout(() => this.tollBells(), 2500);
  }

  // The thirteen tolls of the opening, then the jack-o-lanterns turn.
  tollBells() {
    let n = 0;
    const t = setInterval(() => {
      this.audio.bell(196);
      n++;
      if (n >= 13) { clearInterval(t); whisper('every carved face turns toward you'); this.player.addDread(20); }
    }, 700);
  }

  onNoteRead(note) {
    if (note.title.startsWith("Embalmer")) this.flags.ledgerRead = true;
    if (note.title.startsWith('A Banishment')) {
      this.flags.nameFound = true;
      showToast('You memorize the name beneath the pumpkins: “HOLLOW-JOHN.”');
      whisper('a name is a leash');
    }
  }
  onLoot() {}

  onBossDefeated() {
    this.flags.bossDead = true;
    this.audio.bell(160);
    showToast('THE FIRST HARVEST BELL IS SILENCED');
  }

  update(dt) {
    // region discovery
    const p = this.player.pos;
    const reg = this.world.regionAt(p.x, p.z);
    if (!this.visited.has(reg.id) && this._inRegion(p, reg)) {
      this.visited.add(reg.id);
      if (reg.id !== 'gravewick') {
        showToast(`Entering ${reg.name}`);
        this.audio.ghostHiss();
      }
    }
    // advance objective
    const cur = this.steps[this.step];
    if (cur && cur.done()) {
      this.step = Math.min(this.steps.length - 1, this.step + 1);
      this.set(this.steps[this.step].text);
      if (this.step < this.steps.length) { this.audio.pickup(); }
    }
  }

  _inRegion(p, reg) {
    return dist2D(p.x, p.z, reg.x, reg.z) < reg.r * 0.8;
  }

  // direction (radians, world yaw) toward the current objective target, for the compass
  objectiveTarget() {
    switch (this.step) {
      case 0:
      case 1: return this.world.funeralHome;
      case 2:
      case 3: return { x: REGIONS[1].x, z: REGIONS[1].z };
      case 4: return { x: REGIONS[5].x, z: REGIONS[5].z };
      default: return null;
    }
  }
}
