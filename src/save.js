// ============================================================
// save.js — localStorage persistence. The Long October loops,
// but your progress shouldn't. Auto-saves; K saves, L loads.
// ============================================================
import { showToast } from './utils.js';

const KEY = 'hallowind.save.v1';

export class Save {
  constructor(player, quests, npcs, weapons) {
    this.player = player; this.quests = quests; this.npcs = npcs; this.weapons = weapons;
    this._autoT = 20;
  }

  has() { try { return !!localStorage.getItem(KEY); } catch { return false; } }

  save(announce = true) {
    const p = this.player;
    const data = {
      t: Date.now(),
      pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch,
      stats: p.stats, level: p.level, xp: p.xp, xpNext: p.xpNext,
      maxHP: p.maxHP, hp: p.hp, maxWisp: p.maxWisp, wisp: p.wisp,
      dread: p.dread, coin: p.coin, skillPoints: p.skillPoints,
      lanternOn: p.lanternOn, flags: p.flags,
      ammoMax: this.weapons.ammoMax,
      questStep: this.quests.step, questFlags: this.quests.flags,
      visited: [...this.quests.visited],
      companion: this.npcs.companion ? this.npcs.companion.name : null,
      inInterior: !!p.interior,
      factions: this.factions ? this.factions.serialize() : null,
      bells: this.bells ? this.bells.serialize() : null,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      if (announce) showToast('◈ The loop remembers. (saved)');
    } catch (e) { showToast('Could not save (storage blocked).'); }
  }

  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch { data = null; }
    if (!data) { showToast('No memory of a prior loop.'); return false; }
    const p = this.player;
    // never load straight into an interior cell — return to the overworld point
    if (data.inInterior && this.onForceExitInterior) this.onForceExitInterior();
    p.pos.set(data.pos[0], data.pos[1], data.pos[2]); p.yaw = data.yaw; p.pitch = data.pitch;
    Object.assign(p.stats, data.stats);
    p.level = data.level; p.xp = data.xp; p.xpNext = data.xpNext;
    p.maxHP = data.maxHP; p.hp = data.hp; p.maxWisp = data.maxWisp; p.wisp = data.wisp;
    p.dread = p.dreadTarget = data.dread; p.coin = data.coin; p.skillPoints = data.skillPoints || 0;
    p.flags = data.flags || {};
    if (data.lanternOn && !p.lanternOn) p.toggleLantern();
    this.weapons.ammoMax = data.ammoMax || 6; this.weapons.ammo = this.weapons.ammoMax;

    this.quests.step = data.questStep || 0;
    Object.assign(this.quests.flags, data.questFlags || {});
    this.quests.visited = new Set(data.visited || []);
    this.quests.set(this.quests.steps[this.quests.step].text);

    document.getElementById('coin-n').textContent = p.coin;
    document.getElementById('level').textContent = `Wickmarked · Lv ${p.level}`;

    if (data.companion && !this.npcs.companion) {
      const m = this.npcs.list.find(n => n.name === data.companion);
      if (m) this.npcs.recruit(m);
    }
    if (this.factions && data.factions) this.factions.load(data.factions);
    if (this.bells && data.bells) this.bells.load(data.bells);
    showToast('◈ You step back into a loop already in progress. (loaded)');
    return true;
  }

  update(dt) {
    this._autoT -= dt;
    if (this._autoT <= 0) { this._autoT = 25; this.save(false); }
  }
}
