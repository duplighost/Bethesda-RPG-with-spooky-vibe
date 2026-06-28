// ============================================================
// utils.js — small shared helpers + a deterministic RNG so the
// county regenerates identically every session ("the loop").
// ============================================================

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

// Mulberry32 — tiny seeded PRNG. The Long October repeats the same.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, a, b) => a + (b - a) * rng();
export const randInt = (rng, a, b) => Math.floor(a + (b - a + 1) * rng());
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// Distance on the XZ plane (the ground plane in our world).
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// HUD text helpers ------------------------------------------------
export function showToast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function whisper(msg, ms = 4200) {
  const el = document.getElementById('whisper');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(whisper._t);
  whisper._t = setTimeout(() => el.classList.remove('show'), ms);
}
