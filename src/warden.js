// ============================================================
// warden.js — a Lantern Wardens contract questline. Mara hands
// you monster-hunting contracts; clearing them raises Warden
// standing and ends in a reputation-gated reward.
// ============================================================
import { showToast, whisper } from './utils.js';

export class Warden {
  constructor(player, factions, quests) {
    this.player = player; this.factions = factions; this.quests = quests;
    this.started = false; this.complete = false; this.step = 0;
    this.steps = [
      { id: 'cull',   desc: 'Cull the husks — destroy 6 scarecrows or jacklings.', need: 6, prog: 0, fams: ['scarecrow', 'jackling'] },
      { id: 'banish', desc: 'Banish 4 restless ghosts.',                          need: 4, prog: 0, fams: ['ghost'] },
      { id: 'hunt',   desc: 'Put down something that was almost a person — a werebeast or a vampire.', need: 2, prog: 0, fams: ['werebeast', 'leech'] },
      { id: 'bell',   desc: 'Silence a Harvest Bell the Warden way.',             need: 1, prog: 0, bell: true },
    ];
  }

  start() {
    if (this.started) { showToast('You already carry a Warden contract.'); return; }
    this.started = true; this.step = 0;
    showToast('Lantern Warden contract accepted.');
    whisper('“earn the star. then we’ll talk about the rest.”');
    this._announce();
  }

  cur() { return this.steps[this.step]; }
  _announce() { if (this.cur()) showToast(`[Warden] ${this.cur().desc}`); }

  onKill(e) {
    if (!this.started || this.complete) return;
    const s = this.cur();
    if (s && s.fams && s.fams.includes(e.type)) {
      s.prog++;
      if (s.prog >= s.need) this._advance();
      else if (s.prog % 2 === 0 || s.need - s.prog <= 2) showToast(`[Warden] ${s.id}: ${s.prog}/${s.need}`);
    }
  }
  onBellSilenced() {
    if (!this.started || this.complete) return;
    const s = this.cur();
    if (s && s.bell) { s.prog = s.need; this._advance(); }
  }

  _advance() {
    this.factions.modify('wardens', 12);
    showToast('[Warden] Contract step complete.');
    this.step++;
    if (this.step >= this.steps.length) this._finish();
    else this._announce();
  }

  _finish() {
    this.complete = true;
    this.factions.modify('wardens', 25);
    this.player.stats.aim += 2; this.player.stats.instinct += 1;
    this.player.flags.wardenStar = true;
    showToast("THE WARDEN'S SILVER STAR — +2 Aim, +1 Instinct. You hunt under hunter law now.");
    whisper('“you’re one of us. for whatever that’s worth, these nights.”');
  }

  journalLines() {
    if (!this.started) return ['— no Warden contract (ask Mara Vale).'];
    if (this.complete) return ['✓ Warden’s Silver Star earned — sworn to hunter law.'];
    return this.steps.map((s, i) => {
      const mark = i < this.step ? '✓' : (i === this.step ? '›' : '○');
      const prog = s.bell ? '' : ` (${Math.min(s.prog, s.need)}/${s.need})`;
      return `${mark} ${s.desc}${prog}`;
    });
  }

  serialize() { return { started: this.started, complete: this.complete, step: this.step, prog: this.steps.map(s => s.prog) }; }
  load(d) {
    if (!d) return;
    this.started = d.started; this.complete = d.complete; this.step = d.step || 0;
    if (d.prog) d.prog.forEach((p, i) => { if (this.steps[i]) this.steps[i].prog = p; });
  }
}
