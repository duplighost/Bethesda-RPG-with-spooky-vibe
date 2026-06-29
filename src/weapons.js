// ============================================================
// weapons.js — the player's two hands: a silver-loaded revolver
// (hitscan) and the lantern arm (Hexbolt projectile + Lantern
// Flare AoE). Includes view-model, muzzle flash, recoil, hitmarker.
// ============================================================
import * as THREE from 'three';
import { clamp, showToast } from './utils.js';

export class Weapons {
  constructor(camera, scene, player, enemies, audio) {
    this.camera = camera;
    this.scene = scene;
    this.player = player;
    this.enemies = enemies;
    this.audio = audio;

    this.mode = 'gun';      // 'gun' | 'spell'
    this.ammo = 6; this.ammoMax = 6;
    this.reloadT = 0; this.fireCd = 0; this.spellCd = 0; this.flareCd = 0;

    this.raycaster = new THREE.Raycaster();
    this.bolts = [];        // active projectiles (bolts + bombs)
    this._buildViewmodel();
    this._muzzle();
    this._initSpells();
  }

  _buildViewmodel() {
    // A simple stylised first-person arm + revolver / lantern, parented to camera.
    this.vm = new THREE.Group();
    this.camera.add(this.vm);
    this.vm.position.set(0.32, -0.34, -0.6);

    // revolver
    this.gun = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2114, roughness: 0.9 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.34), steel);
    barrel.position.set(0, 0.02, -0.18); this.gun.add(barrel);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), steel);
    cyl.rotation.x = Math.PI / 2; cyl.position.set(0, 0, -0.02); this.gun.add(cyl);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.07), wood);
    grip.position.set(0, -0.11, 0.04); grip.rotation.x = 0.35; this.gun.add(grip);
    this.vm.add(this.gun);

    // lantern arm
    this.lanternVM = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x14110d, metalness: 0.5, roughness: 0.6 }));
    this.lanternVM.add(frame);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.09),
      new THREE.MeshBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.5 }));
    this.lanternVM.add(glass);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9c0 }));
    this.lanternVM.add(core); this.lanternCore = core;
    this.lanternVM.position.set(-0.05, 0.02, 0.02);
    this.lanternVM.visible = false;
    this.vm.add(this.lanternVM);
  }

  _muzzle() {
    this.muzzle = new THREE.PointLight(0xffd070, 0, 8, 2);
    this.camera.add(this.muzzle);
    this.muzzle.position.set(0.3, -0.25, -0.9);
    this.flashSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.flashSprite.position.set(0.3, -0.26, -0.92);
    this.camera.add(this.flashSprite);
  }

  setMode(m) {
    this.mode = m;
    this.gun.visible = (m === 'gun');
    this.lanternVM.visible = (m === 'spell');
    document.getElementById('weapon-name').textContent = m === 'gun' ? 'BONE REVOLVER' : this.equippedSpell().name;
    this._updateAmmoHUD();
  }

  _maybeLifesteal(dmg) {
    if (this.player.lifestealT > 0) this.player.heal(dmg * 0.3);
  }

  _updateAmmoHUD() {
    const cur = document.getElementById('ammo-cur');
    const max = document.getElementById('ammo-max');
    const sep = document.getElementById('ammo-sep');
    if (this.mode === 'gun') {
      cur.textContent = this.reloadT > 0 ? '↻' : this.ammo;
      max.textContent = this.ammoMax; sep.style.display = '';
    } else {
      cur.textContent = Math.floor(this.player.wisp); max.textContent = ''; sep.style.display = 'none';
    }
  }

  // ----- spell roster (multiple schools; Hex-gated) -----
  _initSpells() {
    this.husks = [];
    this.spellIndex = 0;
    this.spells = [
      { id: 'hexbolt', name: 'HEXBOLT', school: 'Hexcraft', cost: 14, cd: 0.45, reqHex: 0, cast: () => this._spellHexbolt() },
      { id: 'pumpkin', name: 'PUMPKIN BOMB', school: 'Harvestcraft', cost: 24, cd: 1.0, reqHex: 4, cast: () => this._spellPumpkin() },
      { id: 'vine',    name: 'VINE SNARE', school: 'Harvestcraft', cost: 18, cd: 1.6, reqHex: 5, cast: () => this._spellVine() },
      { id: 'husk',    name: 'RAISE HUSK', school: 'Gravecraft', cost: 30, cd: 6.0, reqHex: 6, cast: () => this._spellHusk() },
      { id: 'ward',    name: 'BLOOD WARD', school: 'Bloodcraft', cost: 10, cd: 8.0, reqHex: 5, cast: () => this._spellWard() },
      { id: 'stitch',  name: 'RED STITCH', school: 'Bloodcraft', cost: 16, cd: 7.0, reqHex: 7, cast: () => this._spellStitch() },
    ];
  }
  spellUnlocked(s) { return this.player.stats.hex >= s.reqHex; }
  equippedSpell() { return this.spells[this.spellIndex]; }
  equipSpell(i) {
    if (i < 0 || i >= this.spells.length) return;
    const s = this.spells[i];
    if (!this.spellUnlocked(s)) { showToast(`${s.name} needs Hex ${s.reqHex}`); return; }
    this.spellIndex = i;
    if (this.mode !== 'spell') this.setMode('spell'); else this._refreshSpellName();
    showToast(`${s.name} · ${s.school}`);
  }
  cycleSpell(dir) {
    let i = this.spellIndex;
    for (let n = 0; n < this.spells.length; n++) {
      i = (i + dir + this.spells.length) % this.spells.length;
      if (this.spellUnlocked(this.spells[i])) { this.equipSpell(i); return; }
    }
  }
  _refreshSpellName() {
    if (this.mode === 'spell') document.getElementById('weapon-name').textContent = this.equippedSpell().name;
  }

  // ----- actions -----
  primary() { // LMB
    if (this.player.dead) return;
    if (this.mode === 'gun') this._fireGun();
    else this.castEquipped();
  }
  secondary() { // RMB always quick-casts the equipped spell
    if (this.player.dead) return;
    this.castEquipped();
  }

  castEquipped() {
    if (this.spellCd > 0) return;
    const s = this.equippedSpell();
    if (!this.spellUnlocked(s)) { showToast(`${s.name} needs Hex ${s.reqHex}`); return; }
    const cost = Math.round(s.cost * this.player.spellCostMult);
    if (this.player.wisp < cost) { showToast('Not enough Wisp.'); return; }
    this.player.wisp -= cost;
    this.spellCd = s.cd;
    s.cast();
    this.enemies.alert(this.player.pos, 16);   // magic crackles
    this._updateAmmoHUD();
  }

  _hitmarker() {
    const hm = document.getElementById('hitmarker');
    hm.classList.remove('show'); void hm.offsetWidth; hm.classList.add('show');
  }

  _fireGun() {
    if (this.fireCd > 0 || this.reloadT > 0) return;
    if (this.ammo <= 0) { this.reload(); return; }
    this.ammo--; this.fireCd = 0.28 * this.player.fireCdMult;
    this.audio.gunshot();
    this.enemies.alert(this.player.pos, 32);   // gunshots are loud
    this.player.recoilKick += 0.05 + Math.random() * 0.02;
    // muzzle flash
    this.muzzle.intensity = 4; this.flashSprite.material.opacity = 0.9;
    this.flashSprite.rotation.z = Math.random() * Math.PI;

    // hitscan: silver round. "One Last Bullet" — 6th shot crits.
    const dir = this.player.getDir();
    this.raycaster.set(this.camera.getWorldPosition(new THREE.Vector3()), dir);
    this.raycaster.far = 200;
    const crit = this.ammo === 0;
    let dmg = (16 + this.player.stats.aim * 2) * (crit ? 2.5 : 1) * this.player.gunDmgMult;
    const hit = this.enemies.raycastHit(this.raycaster);
    if (hit) {
      this.enemies.applyDamage(hit.enemy, dmg, hit.point, 'silver', crit);
      this._maybeLifesteal(dmg);
      this._hitmarker();
      if (crit) showToast('ONE LAST BULLET');
    }
    this._updateAmmoHUD();
  }

  reload() {
    if (this.mode !== 'gun' || this.reloadT > 0 || this.ammo === this.ammoMax) return;
    this.reloadT = 1.1 * this.player.reloadMult;
    this.audio.reloadClick();
    this._updateAmmoHUD();
  }

  _hexDmg(base) {
    // Black Bargain: high Dread makes magic hit harder.
    return (base + this.player.stats.hex * 3) * (1 + this.player.dread01() * 0.8);
  }
  _origin() { return this.camera.getWorldPosition(new THREE.Vector3()); }

  // Hexcraft — witchfire bolt
  _spellHexbolt() {
    this.audio.spell();
    const dir = this.player.getDir().clone();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0x9dff6a }));
    mesh.position.copy(this._origin()).add(dir.clone().multiplyScalar(1.2));
    this.scene.add(mesh);
    mesh.add(new THREE.PointLight(0x8dff6a, 1.4, 8, 2));
    this.bolts.push({ type: 'bolt', mesh, dir, dmg: this._hexDmg(20), life: 2.4 });
    this.player.recoilKick += 0.025;
  }

  // Harvestcraft — lobbed gourd that bursts for AoE
  _spellPumpkin() {
    this.audio.spell();
    const dir = this.player.getDir().clone();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd2691e, emissive: 0x4a1800, emissiveIntensity: 0.8 }));
    mesh.position.copy(this._origin()).add(dir.clone().multiplyScalar(1.2));
    this.scene.add(mesh);
    mesh.add(new THREE.PointLight(0xff7a1e, 1.2, 8, 2));
    this.bolts.push({ type: 'bomb', mesh, dir, vy: 6, dmg: this._hexDmg(28), radius: 5, life: 3 });
    this.player.recoilKick += 0.04;
  }

  // Harvestcraft — roots everything around the aim point
  _spellVine() {
    this.audio.spell();
    const dir = this.player.getDir().clone();
    const center = this._origin().add(dir.multiplyScalar(8));
    this.enemies.snare(center, 6, 3.0);
    // visual vines
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.2, 5),
        new THREE.MeshStandardMaterial({ color: 0x2e3d18, roughness: 1 }));
      const vx = center.x + Math.cos(a) * 2, vz = center.z + Math.sin(a) * 2;
      vine.position.set(vx, this.enemies.world.getHeight(vx, vz) + 1.1, vz);
      vine.rotation.z = (Math.random() - 0.5) * 0.6;
      this.scene.add(vine);
      this._fx2 = this._fx2 || [];
      this._fx2.push({ mesh: vine, life: 3.2 });
    }
    showToast('VINE SNARE');
  }

  // Gravecraft — raise a temporary husk ally
  _spellHusk() {
    this.audio.bell(120);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 1, emissive: 0x0a1a0a, emissiveIntensity: 0.4 }));
    body.position.y = 1.0; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a5a48, roughness: 1 }));
    head.position.y = 1.7; g.add(head);
    g.add(new THREE.PointLight(0x6dff5a, 0.6, 5, 2));
    const p = this.player.pos;
    g.position.set(p.x + (Math.random() - 0.5) * 3, this.enemies.world.getHeight(p.x, p.z), p.z + (Math.random() - 0.5) * 3);
    this.scene.add(g);
    this.husks.push({ group: g, life: 16, atkCd: 0 });
    showToast('RAISE HUSK — it remembers how to be useful');
  }

  // Bloodcraft — spend HP for an absorbing ward
  _spellWard() {
    const hpCost = 12;
    this.player.hp = Math.max(1, this.player.hp - hpCost);
    this.player.shield = this.player.shieldMax = 40 + this.player.stats.hex * 4;
    this.player.shieldT = 12;
    this.audio.flare();
    document.getElementById('flash').classList.remove('go'); void document.getElementById('flash').offsetWidth;
    document.getElementById('flash').classList.add('go');
    showToast(`BLOOD WARD — ${Math.round(this.player.shield)} absorb`);
  }

  // Bloodcraft — a window where damage you deal heals you
  _spellStitch() {
    this.player.lifestealT = 8;
    this.audio.spell();
    showToast('RED STITCH — wounds you open close your own');
  }

  // Q — Lantern Flare: AoE stun + reveal + dread relief. Needs lantern lit.
  flare() {
    if (this.flareCd > 0) return;
    if (!this.player.lanternOn) { showToast('Light the lantern first (F).'); return; }
    this.flareCd = 7;
    this.audio.flare();
    document.getElementById('flash').classList.remove('go');
    void document.getElementById('flash').offsetWidth;
    document.getElementById('flash').classList.add('go');
    const p = this.player.pos;
    this.enemies.flareBurst(p, 16);
    this.enemies.alert(p, 22);
    if (this.player.flareHeals) this.player.heal(20);
    this.player.relieveDread(18);
    showToast('LANTERN FLARE — the dark recoils');
  }

  update(dt) {
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.spellCd = Math.max(0, this.spellCd - dt);
    this.flareCd = Math.max(0, this.flareCd - dt);
    // muzzle decay
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 30);
    this.flashSprite.material.opacity = Math.max(0, this.flashSprite.material.opacity - dt * 6);

    // reload finish
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.ammo = this.ammoMax; this.audio.reloadClick(); }
      this._updateAmmoHUD();
    }
    if (this.mode === 'spell') this._updateAmmoHUD();

    // lantern core pulse
    if (this.lanternCore) {
      const s = 1 + Math.sin(performance.now() * 0.01) * 0.2;
      this.lanternCore.scale.setScalar(this.player.lanternOn ? s * 1.4 : s);
    }

    // viewmodel recoil/sway lerp
    const targetZ = -0.6 + this.player.recoilKick * 1.2;
    this.vm.position.z += (targetZ - this.vm.position.z) * Math.min(1, dt * 12);

    // advance projectiles
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      if (b.type === 'bomb') {
        b.vy -= 14 * dt;
        b.mesh.position.add(b.dir.clone().multiplyScalar(20 * dt));
        b.mesh.position.y += b.vy * dt;
        b.mesh.rotation.x += dt * 6;
        b.life -= dt;
        const ground = this.enemies.world.getHeight(b.mesh.position.x, b.mesh.position.z);
        if (b.mesh.position.y <= ground + 0.3 || b.life <= 0) {
          this.enemies.areaDamage(b.mesh.position, b.radius, b.dmg, 'witchfire');
          this._maybeLifesteal(b.dmg);
          this.enemies.spawnExplosion?.(b.mesh.position, b.radius);
          this.audio.thud(55);
          this.scene.remove(b.mesh); b.mesh.geometry.dispose(); this.bolts.splice(i, 1);
        }
        continue;
      }
      b.mesh.position.add(b.dir.clone().multiplyScalar(38 * dt));
      b.life -= dt;
      const hit = this.enemies.boltHit(b.mesh.position, 1.0);
      if (hit || b.life <= 0) {
        if (hit) { this.enemies.applyDamage(hit, b.dmg, b.mesh.position, 'witchfire', false); this._maybeLifesteal(b.dmg); this._hitmarker(); }
        this.scene.remove(b.mesh); b.mesh.geometry.dispose(); this.bolts.splice(i, 1);
      }
    }

    // husk allies
    for (let i = this.husks.length - 1; i >= 0; i--) {
      const h = this.husks[i];
      h.life -= dt; h.atkCd = Math.max(0, h.atkCd - dt);
      let tgt = null, bd = 18;
      for (const e of this.enemies.list) {
        if (e.dead) continue;
        const d = Math.hypot(e.group.position.x - h.group.position.x, e.group.position.z - h.group.position.z);
        if (d < bd) { bd = d; tgt = e; }
      }
      if (tgt) {
        const dx = tgt.group.position.x - h.group.position.x, dz = tgt.group.position.z - h.group.position.z;
        const d = Math.hypot(dx, dz) || 1;
        h.group.rotation.y = Math.atan2(dx, dz);
        if (d > 1.8) { const sp = Math.min(6 * dt, d - 1.6); h.group.position.x += dx / d * sp; h.group.position.z += dz / d * sp; }
        else if (h.atkCd <= 0) { h.atkCd = 0.9; this.enemies.applyDamage(tgt, 14 + this.player.stats.hex, tgt.group.position, 'witchfire', false); }
      }
      h.group.position.y = this.enemies.world.getHeight(h.group.position.x, h.group.position.z);
      if (h.life <= 0) { this.scene.remove(h.group); this.husks.splice(i, 1); }
    }

    // fading vine props
    if (this._fx2) {
      for (let i = this._fx2.length - 1; i >= 0; i--) {
        const f = this._fx2[i]; f.life -= dt;
        f.mesh.scale.y = Math.max(0.01, Math.min(1, f.life));
        if (f.life <= 0) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); this._fx2.splice(i, 1); }
      }
    }
  }
}
