// ============================================================
// factions.js — six morally-diseased powers vie for Hallow
// County. Reputation shifts with your deeds and your dealings,
// changing vendor prices, dialogue, and which ending you can reach.
// ============================================================
import { clamp, showToast } from './utils.js';

export const FACTIONS = [
  { id: 'wardens',  name: 'The Lantern Wardens',      blurb: 'Exorcists with rifles. Break the curse — and anyone too far gone.', color: '#cfe0ff' },
  { id: 'church',   name: 'The Candle Church',        blurb: 'Protects the living. Worships miracles it should not trust.',       color: '#ffe9b0' },
  { id: 'court',    name: 'The Grinning Court',        blurb: 'Masked aristocrats and vampires. Order, paid for in blood.',        color: '#d98cff' },
  { id: 'harvest',  name: 'The Children of the Harvest', blurb: 'Pumpkin cultists who would let October swallow the world.',      color: '#ff9a3a' },
  { id: 'ashunion', name: 'The Ash Union Dead',        blurb: 'Ghost workers owed seventy-three Octobers of back pay.',           color: '#8dff6a' },
  { id: 'mask',     name: 'The Mask Market',           blurb: 'Smugglers who care only who pays.',                                 color: '#e8c46a' },
];

const TIERS = [
  { at: -60, label: 'Hated' },
  { at: -25, label: 'Disliked' },
  { at: -8,  label: 'Wary' },
  { at: 8,   label: 'Neutral' },
  { at: 25,  label: 'Liked' },
  { at: 60,  label: 'Trusted' },
  { at: 101, label: 'Allied' },
];

export class Factions {
  constructor(player) {
    this.player = player;
    this.rep = {};
    for (const f of FACTIONS) this.rep[f.id] = 0;
    this.rep.mask = 8; // traders tolerate everyone a little
  }

  modify(id, delta, announce = true) {
    if (this.rep[id] === undefined) return;
    const before = this.standing(id).label;
    this.rep[id] = clamp(this.rep[id] + delta, -100, 100);
    const after = this.standing(id).label;
    if (announce && before !== after) {
      const f = FACTIONS.find(x => x.id === id);
      showToast(`${f.name}: now ${after}`);
    }
  }

  get(id) { return this.rep[id] ?? 0; }
  standing(id) {
    const v = this.rep[id] ?? 0;
    let t = TIERS[0];
    for (const tier of TIERS) { if (v >= tier.at) t = tier; }
    // find the label whose band contains v
    for (let i = 0; i < TIERS.length; i++) {
      if (v < TIERS[i].at) { return { label: i === 0 ? 'Hated' : TIERS[i - 1].label, tier: i - 1, value: v }; }
    }
    return { label: 'Allied', tier: TIERS.length - 1, value: v };
  }

  // Mask Market liking → up to 25% off
  vendorDiscount() { return clamp(this.get('mask') / 100 * 0.25, -0.1, 0.25); }

  // killing monsters earns a sliver of Warden favour; cult/harvest kills more
  onKill(enemy) {
    if (enemy.type === 'scarecrow' || enemy.type === 'jackling' || enemy.isBoss) this.modify('wardens', enemy.isBoss ? 6 : 0.4, false);
    else this.modify('wardens', 0.3, false);
  }

  serialize() { return { ...this.rep }; }
  load(obj) { if (obj) Object.assign(this.rep, obj); }
}
