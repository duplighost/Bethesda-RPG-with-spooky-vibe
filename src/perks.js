// ============================================================
// perks.js — spend the skill points you earn each level on a
// small perk tree. Effects are applied to the player and read by
// weapons/enemies (multipliers + flags). Owned perks persist.
// ============================================================
import { showToast } from './utils.js';

export const PERKS = [
  // --- Gunslinger ---
  { id: 'deadmans',   cat: 'Gunslinger', name: "Dead Man's Draw", cost: 1, desc: 'Reload 30% faster.',           apply: (p) => { p.reloadMult *= 0.7; } },
  { id: 'quickhands', cat: 'Gunslinger', name: 'Quick Hands',     cost: 1, desc: 'Fire 15% faster.',             apply: (p) => { p.fireCdMult *= 0.85; } },
  { id: 'silverhabit',cat: 'Gunslinger', name: 'Silver Habit',    cost: 2, desc: '+25% firearm damage.', req: { stat: 'aim', v: 5 }, apply: (p) => { p.gunDmgMult *= 1.25; } },
  // --- Occult ---
  { id: 'hexaddict',  cat: 'Occult',     name: 'Hex Addict',      cost: 1, desc: 'Spells cost 20% less Wisp.',   apply: (p) => { p.spellCostMult *= 0.8; } },
  { id: 'lanternsaint',cat: 'Occult',    name: 'Lantern Saint',   cost: 2, desc: 'Lantern Flare also heals you.', apply: (p) => { p.flareHeals = true; } },
  { id: 'gravetongue',cat: 'Occult',     name: 'Grave-Tongue',    cost: 2, desc: '+2 Hex.', req: { stat: 'hex', v: 4 }, apply: (p) => { p.stats.hex += 2; } },
  // --- Survival ---
  { id: 'ironhide',   cat: 'Survival',   name: 'Iron Hide',       cost: 1, desc: '+25 max Vitality.',            apply: (p) => { p.maxHP += 25; p.hp = p.maxHP; } },
  { id: 'bramble',    cat: 'Survival',   name: 'Bramble Skin',    cost: 2, desc: 'Attackers take recoil damage.', apply: (p) => { p.thornMail += 9; } },
  // --- Stealth ---
  { id: 'basementrat',cat: 'Stealth',    name: 'Basement Rat',    cost: 1, desc: 'Move 30% faster indoors.',     apply: (p) => { p.interiorSpeedMult *= 1.3; } },
  { id: 'floorboard', cat: 'Stealth',    name: 'Floorboard Whisperer', cost: 2, desc: 'Sneak attacks deal x3 (was x2).', apply: (p) => { p.sneakMult = 3.0; } },
];

export function canBuy(player, perk) {
  if (player.perks.includes(perk.id)) return { ok: false, why: 'owned' };
  if (player.skillPoints < perk.cost) return { ok: false, why: `needs ${perk.cost} pts` };
  if (perk.req && player.stats[perk.req.stat] < perk.req.v) return { ok: false, why: `needs ${perk.req.stat} ${perk.req.v}` };
  return { ok: true };
}

export function buyPerk(player, perkId) {
  const perk = PERKS.find(p => p.id === perkId); if (!perk) return false;
  const c = canBuy(player, perk); if (!c.ok) { showToast(`Can't take ${perk.name} — ${c.why}.`); return false; }
  player.skillPoints -= perk.cost;
  player.perks.push(perk.id);
  perk.apply(player);
  showToast(`Perk: ${perk.name}`);
  return true;
}

// re-apply owned perks on load (skip stat/HP perks that already baked into the save)
export function reapplyPerks(player) {
  for (const id of player.perks) {
    const perk = PERKS.find(p => p.id === id);
    // only re-apply pure multiplier/flag perks; stat/HP perks are already in saved values
    if (perk && !['ironhide', 'gravetongue'].includes(id)) perk.apply(player);
  }
}
