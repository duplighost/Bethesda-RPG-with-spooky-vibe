// ============================================================
// dialogue.js — a small branching dialogue runner with RPG
// stat-checks ([Presence 6], [Hex 5], [Monster Lore 4], …).
// Trees are plain objects: { start: node, nodeId: node, ... }.
//   node = { speaker, text, options: [opt, ...] }
//   opt  = { label, goto, end, check:{stat,dc}, action, fail:{...} }
// ============================================================
import { clamp } from './utils.js';

const STAT_LABELS = {
  grit: 'Grit', aim: 'Aim', wits: 'Wits', hex: 'Hex',
  guile: 'Guile', presence: 'Presence', instinct: 'Instinct',
  lore: 'Monster Lore', dread: 'Dread',
};

export class Dialogue {
  constructor(player) {
    this.player = player;
    this.active = false;
    this.el = document.getElementById('dialogue');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.textEl = document.getElementById('dialogue-text');
    this.optsEl = document.getElementById('dialogue-options');
  }

  // pull the effective value for a check stat (lore & dread are derived)
  _statValue(stat) {
    if (stat === 'lore') return Math.round((this.player.stats.instinct + this.player.stats.wits) / 2) + 2;
    if (stat === 'dread') return Math.round(this.player.dread);
    return this.player.stats[stat] ?? 0;
  }

  open(tree, ctx = {}) {
    this.tree = tree; this.ctx = ctx;
    this.active = true;
    this.el.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this._show('start');
  }

  close() {
    this.active = false;
    this.el.classList.add('hidden');
    if (this.ctx?.onClose) this.ctx.onClose();
  }

  _show(nodeId) {
    let node = this.tree[nodeId];
    if (typeof node === 'function') node = node(this.ctx, this.player);
    if (!node) { this.close(); return; }
    this.speakerEl.textContent = node.speaker || '';
    this.textEl.textContent = typeof node.text === 'function' ? node.text(this.ctx, this.player) : node.text;
    this.optsEl.innerHTML = '';

    const options = (typeof node.options === 'function' ? node.options(this.ctx, this.player) : node.options) || [
      { label: '(Leave.)', end: true },
    ];
    for (const opt of options) {
      if (opt.hide && opt.hide(this.ctx, this.player)) continue;
      const b = document.createElement('button');
      b.className = 'dlg-opt' + (opt.end ? ' leave' : '');
      let tag = '';
      if (opt.check) {
        const val = this._statValue(opt.check.stat);
        const pass = val >= opt.check.dc;
        const cls = pass ? 'chk' : (val >= opt.check.dc - 2 ? 'chk hard' : 'chk fail');
        tag = `<span class="${cls}">[${STAT_LABELS[opt.check.stat] || opt.check.stat} ${opt.check.dc}${pass ? ' ✓' : ''}]</span> `;
      }
      b.innerHTML = tag + (opt.label || '…');
      b.onclick = () => this._choose(opt);
      this.optsEl.appendChild(b);
    }
  }

  _choose(opt) {
    // resolve stat check
    if (opt.check) {
      const val = this._statValue(opt.check.stat);
      const pass = val >= opt.check.dc;
      if (!pass) {
        if (opt.fail?.action) opt.fail.action(this.ctx, this.player);
        if (opt.fail?.goto) return this._show(opt.fail.goto);
        if (opt.fail?.end) return this.close();
        return this.close();
      }
    }
    if (opt.action) opt.action(this.ctx, this.player);
    if (opt.end) return this.close();
    if (opt.goto) return this._show(opt.goto);
    return this.close();
  }
}
