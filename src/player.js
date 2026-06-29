// ============================================================
// player.js — first-person controller, RPG stats, leveling,
// the Dread system, and the Iron Lantern fused to your hand.
// ============================================================
import * as THREE from 'three';
import { clamp, lerp, showToast, whisper } from './utils.js';

// resolve a point against a list of AABB colliders (shared by interiors)
export function collideBoxes(px, pz, radius, boxes) {
  for (const c of boxes) {
    if (px > c.minX - radius && px < c.maxX + radius && pz > c.minZ - radius && pz < c.maxZ + radius) {
      const dl = px - (c.minX - radius), dr = (c.maxX + radius) - px;
      const db = pz - (c.minZ - radius), dtp = (c.maxZ + radius) - pz;
      const mx = Math.min(dl, dr), mz = Math.min(db, dtp);
      if (mx < mz) px = dl < dr ? c.minX - radius : c.maxX + radius;
      else pz = db < dtp ? c.minZ - radius : c.maxZ + radius;
    }
  }
  return [px, pz];
}

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;

    // transform
    this.pos = new THREE.Vector3(0, 0, 8);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;       // face into town
    this.pitch = 0;
    this.height = 1.7;
    this.onGround = true;
    this.radius = 0.5;

    // RPG stats — Grit/Aim/Wits/Hex/Guile etc. (subset wired to play)
    this.stats = { grit: 4, aim: 4, wits: 3, hex: 4, guile: 3, instinct: 3, presence: 3 };
    this.level = 1;
    this.xp = 0;
    this.xpNext = 100;
    this.skillPoints = 0;

    // vitals
    this.maxHP = 100; this.hp = 100;
    this.maxWisp = 100; this.wisp = 100;   // mana for spells
    this.shield = 0; this.shieldMax = 0;   // Blood Ward absorb
    this.lifestealT = 0;                   // Red Stitch window
    this.dread = 0;                        // 0..100
    this.dreadTarget = 0;

    // lantern
    this.lanternOn = false;
    this.lantern = new THREE.PointLight(0xffb260, 0.0, 30, 2);
    this.camera.add(this.lantern);
    this.lantern.position.set(0.4, -0.2, -0.3);
    // soft "sight" fill that brightens nearby surfaces & reveals ghosts
    this.sightLight = new THREE.PointLight(0xcfe0ff, 0.0, 34, 2);
    this.camera.add(this.sightLight);

    // bob / sway
    this.bob = 0; this.recoilKick = 0;

    this.flags = {};
    this.coin = 0;

    // inventory
    this.consumables = {};   // id -> count
    this.keyItems = [];      // [{id,name,desc}]
    this.collectedLoot = []; // titles of picked-up loot/relics (so they don't respawn on reload)

    // crouch / stealth
    this.crouched = false;
    this.noise = 0;          // 0..1, how loud you are right now
    this.detected = false;   // any enemy currently aware of you?

    // perks
    this.perks = [];         // owned perk ids
    this.reloadMult = 1; this.fireCdMult = 1; this.spellCostMult = 1;
    this.gunDmgMult = 1; this.sneakMult = 2.0; this.interiorSpeedMult = 1;
    this.flareHeals = false; this.thornMail = 0;

    this.dead = false;
    this._hurtT = 0;
    this._regenT = 0;
    this._stepT = 0;
  }

  spawnAt(x, z, yaw = Math.PI) {
    this.crouched = false; this.height = 1.7;
    this.pos.set(x, this.world.getHeight(x, z) + this.height, z);
    this.yaw = yaw; this.pitch = 0; this.vel.set(0, 0, 0);
  }

  toggleLantern() {
    this.lanternOn = !this.lanternOn;
    const el = document.getElementById('lantern-on');
    el.textContent = this.lanternOn ? 'LIT' : 'DIM';
    el.classList.toggle('lit', this.lanternOn);
    if (this.lanternOn) showToast('The cold moon in the lantern wakes.');
  }

  // ---- damage / death ----
  damage(amount, source = '') {
    if (this.dead) return;
    // Grit reduces incoming damage a touch.
    amount *= clamp(1 - this.stats.grit * 0.03, 0.4, 1);
    // Blood Ward absorbs first.
    if (this.shield > 0) {
      const a = Math.min(this.shield, amount);
      this.shield -= a; amount -= a;
      if (amount <= 0) { this._hurtT = 0.3; this.audio.hurt(); return; }
    }
    this.hp = Math.max(0, this.hp - amount);
    this._hurtT = 0.5;
    this.audio.hurt();
    document.getElementById('vignette').classList.add('hurt');
    if (this.hp <= 0) this._die();
  }
  heal(a) { this.hp = Math.min(this.maxHP, this.hp + a); }

  // ---- inventory ----
  addConsumable(id, n = 1) { this.consumables[id] = (this.consumables[id] || 0) + n; }
  addKeyItem(id, name, desc) {
    if (this.keyItems.some(k => k.id === id)) return;
    this.keyItems.push({ id, name, desc });
  }

  // ---- crouch / stealth ----
  toggleCrouch() {
    this.crouched = !this.crouched;
    if (this.crouched) showToast('Crouched — quieter, harder to spot.');
  }
  _die() {
    this.dead = true;
    document.getElementById('death').classList.remove('hidden');
  }
  respawn() {
    this.dead = false;
    this.interior = null;
    this.hp = this.maxHP; this.wisp = this.maxWisp;
    this.dread = Math.max(0, this.dread - 25);
    document.getElementById('death').classList.add('hidden');
    document.getElementById('vignette').classList.remove('hurt');
    // wake at the Bellweather funeral home, as the Wickmarked always does
    const f = this.world.funeralHome;
    this.spawnAt(f.x, f.z + 9, Math.PI);
  }

  // ---- progression ----
  addXP(n) {
    this.xp += n;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.floor(this.xpNext * 1.4);
      this.maxHP += 12; this.hp = this.maxHP;
      this.maxWisp += 8; this.wisp = this.maxWisp;
      this.skillPoints++;
      showToast(`◆ LEVEL ${this.level} — the loop knows you better now`);
      this.audio.bell(330);
      document.getElementById('level').textContent = `${this.background || 'Wickmarked'} · Lv ${this.level}`;
    }
  }

  // ---- Dread ----
  addDread(n) { this.dreadTarget = clamp(this.dreadTarget + n, 0, 100); }
  relieveDread(n) { this.dreadTarget = clamp(this.dreadTarget - n, 0, 100); }
  dread01() { return this.dread / 100; }

  // ---- input-driven movement (called each frame) ----
  update(dt, input) {
    if (this.dead) return;

    // mouse look applied in main via addLook()
    this.pitch = clamp(this.pitch, -1.4, 1.4);

    // ground-relative movement basis
    // forward must match the camera look direction (getDir): rotating (0,0,-1)
    // by yaw gives (-sin, 0, -cos). The old (+sin,+cos) was the exact opposite,
    // which made W walk *away* from where you aim.
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // keyboard booleans + analog joystick (mx strafe, my forward)
    let fAxis = (input.fwd ? 1 : 0) - (input.back ? 1 : 0) + (input.my || 0);
    let rAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.mx || 0);
    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, fAxis);
    wish.addScaledVector(right, rAxis);
    const moving = wish.lengthSq() > 0.0004;
    if (wish.length() > 1) wish.normalize();

    const joyMag = Math.hypot(input.mx || 0, input.my || 0);
    const sprint = (input.sprint || joyMag > 0.92) && fAxis > 0.1 && !this.crouched;
    const interiorMult = this.interior ? this.interiorSpeedMult : 1;
    const speed = (sprint ? 9.5 : 5.2) * (this.crouched ? 0.45 : 1) * interiorMult * (1 + this.stats.guile * 0.01);

    // crouch lowers the eye-line
    this.height = lerp(this.height, this.crouched ? 1.05 : 1.7, 1 - Math.pow(0.001, dt));

    // how loud you are — drives enemy detection
    let noise = moving ? (sprint ? 1.0 : (this.crouched ? 0.22 : 0.55)) : (this.crouched ? 0.03 : 0.12);
    if (this.lanternOn) noise += 0.15;
    this.noise = clamp(noise, 0, 1.2);
    // accelerate horizontally
    this.vel.x = lerp(this.vel.x, wish.x * speed, 1 - Math.pow(0.0001, dt));
    this.vel.z = lerp(this.vel.z, wish.z * speed, 1 - Math.pow(0.0001, dt));

    // gravity + jump
    this.vel.y -= 24 * dt;
    if (input.jump && this.onGround) { this.vel.y = 8.2; this.onGround = false; }

    // integrate
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    let groundY;
    if (this.interior) {
      [nx, nz] = collideBoxes(nx, nz, this.radius, this.interior.colliders);
      this.pos.x = clamp(nx, this.interior.min.x, this.interior.max.x);
      this.pos.z = clamp(nz, this.interior.min.z, this.interior.max.z);
      groundY = this.interior.floorY + this.height;
    } else {
      [nx, nz] = this.world.collide(nx, nz, this.radius);
      this.pos.x = clamp(nx, -this.world.WORLD + 4, this.world.WORLD - 4);
      this.pos.z = clamp(nz, -this.world.WORLD + 4, this.world.WORLD - 4);
      groundY = this.world.getHeight(this.pos.x, this.pos.z) + this.height;
    }
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundY) { this.pos.y = groundY; this.vel.y = 0; this.onGround = true; }

    // footstep audio
    if (moving && this.onGround) {
      this._stepT -= dt * (sprint ? 1.6 : 1.0);
      if (this._stepT <= 0) {
        this._stepT = 0.42;
        const surf = this.interior ? 'wood' : this.world.surfaceAt(this.pos.x, this.pos.z);
        this.audio.footstep(surf);
      }
    }

    // view bob
    if (moving && this.onGround) this.bob += dt * (sprint ? 16 : 11);
    const bobY = Math.sin(this.bob) * (sprint ? 0.07 : 0.045);
    const bobX = Math.cos(this.bob * 0.5) * 0.03;

    // recoil decays
    this.recoilKick = lerp(this.recoilKick, 0, 1 - Math.pow(0.001, dt));

    // apply to camera
    this.camera.position.copy(this.pos);
    this.camera.position.y += bobY;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilKick - bobX * 0.1;

    // lantern intensity (flickers when lit)
    const targetL = this.lanternOn ? 2.6 + Math.sin(performance.now() * 0.02) * 0.3 : 0.0;
    this.lantern.intensity = lerp(this.lantern.intensity, targetL, 1 - Math.pow(0.01, dt));
    this.sightLight.intensity = lerp(this.sightLight.intensity, this.lanternOn ? 0.8 : 0.0, 1 - Math.pow(0.01, dt));

    // blood ward + lifesteal timers
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shield = 0; }
    if (this.lifestealT > 0) this.lifestealT -= dt;

    // regen wisp; regen hp slowly when calm
    this.wisp = Math.min(this.maxWisp, this.wisp + dt * (4 + this.stats.hex * 0.4));
    this._regenT -= dt;
    if (this._hurtT <= 0 && this._regenT <= 0) { this.heal(dt * 2.2); }
    this._hurtT = Math.max(0, this._hurtT - dt);
    if (this._hurtT === 0) document.getElementById('vignette').classList.remove('hurt');

    // Dread eases toward target; ambient dread from darkness & being far from light
    this.dread = lerp(this.dread, this.dreadTarget, 1 - Math.pow(0.2, dt));
    // standing in the dark at night slowly unsettles you; the lantern soothes
    if (!this.lanternOn) this.dreadTarget = clamp(this.dreadTarget + dt * 0.4, 0, 100);
    else this.dreadTarget = clamp(this.dreadTarget - dt * 0.6, 0, 100);

    // High Dread perks: whispers leak true lore, spells hit harder (handled in weapons)
    this._dreadFx(dt);
  }

  _dreadFx(dt) {
    const overlay = document.getElementById('dread-overlay');
    overlay.style.opacity = (this.dread01() * 0.9).toFixed(2);
    if (this.dread > 55) {
      this._whisperT = (this._whisperT || 0) - dt;
      if (this._whisperT <= 0) {
        this._whisperT = 9 + Math.random() * 8;
        const lines = [
          'we already came here', 'that one’s not done yet', 'the pumpkins are eggs',
          'don’t answer the door', 'thirteen, then none', 'the moon is not the moon',
          'count the chairs', 'he’s still breathing', 'the corn remembers your route',
        ];
        whisper(lines[Math.floor(Math.random() * lines.length)]);
        this.audio.ghostHiss();
      }
    }
  }

  addLook(dx, dy, sens = 0.0022) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
  }

  // forward direction for raycasting/firing
  getDir() {
    const d = new THREE.Vector3(0, 0, -1);
    d.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return d;
  }
}
