// ============================================================
// inventory.js — usable consumables + a collected key-item log.
// Consumables are stocked by the Mask Market and used from the
// inventory screen (I) or the quick-heal key (H).
// ============================================================
import { showToast } from './utils.js';

export const CONSUMABLES = {
  bonebroth: { name: 'Bonebroth Flask', desc: 'Restore 60 Vitality.', use: (p) => p.heal(60) },
  wisp:      { name: 'Wisp Draught',    desc: 'Restore 50 Wisp.',     use: (p) => { p.wisp = Math.min(p.maxWisp, p.wisp + 50); } },
  saltward:  { name: 'Salt-Ward Charm', desc: 'Shed 40 Dread.',       use: (p) => p.relieveDread(40) },
};

export function useConsumable(player, id) {
  if (!player.consumables[id] || player.consumables[id] <= 0) return false;
  const c = CONSUMABLES[id]; if (!c) return false;
  c.use(player);
  player.consumables[id]--;
  showToast(`Used ${c.name}.`);
  return true;
}

// quick-heal: spend the first available healing item
export function quickHeal(player) {
  if (player.hp >= player.maxHP) { showToast('Already at full Vitality.'); return false; }
  if (useConsumable(player, 'bonebroth')) return true;
  showToast('No Bonebroth Flask to drink.');
  return false;
}
