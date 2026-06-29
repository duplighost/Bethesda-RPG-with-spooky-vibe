// ============================================================
// touch.js — on-screen controls for phones/tablets: a left
// virtual joystick (move), right-side drag to look, and a stack
// of action buttons. Multitouch-aware; hidden on desktop.
// ============================================================

export function isTouchDevice() {
  // ?touch=1 forces controls on (handy for desktop testing); ?touch=0 forces off.
  const q = (typeof location !== 'undefined' && location.search) || '';
  if (/[?&]touch=0\b/.test(q)) return false;
  if (/[?&]touch(=1)?\b/.test(q)) return true;
  // A coarse primary pointer is the reliable signal for phones/tablets.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// actions: { move(mx,my), look(dx,dy), fireDown(), fireUp(), cast(), lantern(),
//            flare(), interact(), reload(), jump(), crouch(), cycleSpell(d), bag() }
export function setupTouch(actions) {
  if (!isTouchDevice()) return false;
  document.body.classList.add('touch');

  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.innerHTML = `
    <div id="look-zone"></div>
    <div id="joystick"><div id="joy-thumb"></div></div>
    <div id="touch-buttons">
      <button class="tbtn" data-a="lantern">☼</button>
      <button class="tbtn" data-a="flare">✦</button>
      <button class="tbtn" data-a="reload">⟳</button>
      <button class="tbtn" data-a="crouch">▼</button>
      <button class="tbtn" data-a="jump">⤒</button>
      <button class="tbtn big" data-a="cast">✷</button>
      <button class="tbtn big" data-a="fire">◎</button>
    </div>
    <button id="touch-interact" class="tbtn wide">E</button>
    <button id="touch-bag" class="tbtn">▤</button>
  `;
  document.body.appendChild(root);

  const joy = root.querySelector('#joystick');
  const thumb = root.querySelector('#joy-thumb');
  const lookZone = root.querySelector('#look-zone');
  const R = 52;
  let joyId = null, joyCx = 0, joyCy = 0;
  let lookId = null, lookX = 0, lookY = 0;

  const T = (e, id) => { for (const t of e.changedTouches) if (t.identifier === id) return t; return null; };

  // ---- joystick ----
  joy.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joy.getBoundingClientRect();
    joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
    moveThumb(t.clientX, t.clientY);
  }, { passive: false });

  function moveThumb(x, y) {
    let dx = x - joyCx, dy = y - joyCy;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx = dx / m * R; dy = dy / m * R; }
    thumb.style.transform = `translate(${dx}px,${dy}px)`;
    actions.move(dx / R, -dy / R);   // up on screen = forward
  }

  // ---- look (right-side drag) ----
  lookZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (lookId !== null) return;
    const t = e.changedTouches[0];
    lookId = t.identifier; lookX = t.clientX; lookY = t.clientY;
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { e.preventDefault(); moveThumb(t.clientX, t.clientY); }
      else if (t.identifier === lookId) {
        e.preventDefault();
        actions.look(t.clientX - lookX, t.clientY - lookY);
        lookX = t.clientX; lookY = t.clientY;
      }
    }
  }, { passive: false });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; thumb.style.transform = 'translate(0,0)'; actions.move(0, 0); }
      if (t.identifier === lookId) lookId = null;
    }
  }
  document.addEventListener('touchend', endTouch);
  document.addEventListener('touchcancel', endTouch);

  // ---- buttons ----
  root.querySelectorAll('.tbtn').forEach(btn => {
    const a = btn.dataset.a || btn.id;
    if (a === 'fire') {
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); btn.classList.add('held'); actions.fireDown(); }, { passive: false });
      btn.addEventListener('touchend', (e) => { e.preventDefault(); btn.classList.remove('held'); actions.fireUp(); });
    } else {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        ({ cast: actions.cast, lantern: actions.lantern, flare: actions.flare, reload: actions.reload,
           crouch: actions.crouch, jump: actions.jump })[a]?.();
      }, { passive: false });
    }
  });
  root.querySelector('#touch-interact').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); actions.interact(); }, { passive: false });
  root.querySelector('#touch-bag').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); actions.bag(); }, { passive: false });

  return true;
}
