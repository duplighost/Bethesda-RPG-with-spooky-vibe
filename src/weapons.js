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
    this.bolts = [];        // active hexbolt projectiles
    this._buildViewmodel();
    this._muzzle();
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
    const name = m === 'gun' ? 'BONE REVOLVER' : 'HEXBOLT — Witchfire';
    document.getElementById('weapon-name').textContent = name;
    this._updateAmmoHUD();
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

  // ----- actions -----
  primary() { // LMB
    if (this.player.dead) return;
    if (this.mode === 'gun') this._fireGun();
    else this._castBolt();
  }
  secondary() { // RMB always casts a bolt regardless of mode (quick magic)
    this._castBolt();
  }

  _hitmarker() {
    const hm = document.getElementById('hitmarker');
    hm.classList.remove('show'); void hm.offsetWidth; hm.classList.add('show');
  }

  _fireGun() {
    if (this.fireCd > 0 || this.reloadT > 0) return;
    if (this.ammo <= 0) { this.reload(); return; }
    this.ammo--; this.fireCd = 0.28;
    this.audio.gunshot();
    this.player.recoilKick += 0.05 + Math.random() * 0.02;
    // muzzle flash
    this.muzzle.intensity = 4; this.flashSprite.material.opacity = 0.9;
    this.flashSprite.rotation.z = Math.random() * Math.PI;

    // hitscan: silver round. "One Last Bullet" — 6th shot crits.
    const dir = this.player.getDir();
    this.raycaster.set(this.camera.getWorldPosition(new THREE.Vector3()), dir);
    this.raycaster.far = 200;
    const crit = this.ammo === 0;
    let dmg = (16 + this.player.stats.aim * 2) * (crit ? 2.5 : 1);
    const hit = this.enemies.raycastHit(this.raycaster);
    if (hit) {
      this.enemies.applyDamage(hit.enemy, dmg, hit.point, 'silver', crit);
      this._hitmarker();
      if (crit) showToast('ONE LAST BULLET');
    }
    this._updateAmmoHUD();
  }

  reload() {
    if (this.mode !== 'gun' || this.reloadT > 0 || this.ammo === this.ammoMax) return;
    this.reloadT = 1.1;
    this.audio.reloadClick();
    this._updateAmmoHUD();
  }

  _castBolt() {
    if (this.spellCd > 0) return;
    const cost = 14;
    if (this.player.wisp < cost) { showToast('Not enough Wisp.'); return; }
    this.player.wisp -= cost; this.spellCd = 0.45;
    this.audio.spell();
    // Black Bargain at high Dread: bolts hit harder
    const dreadBonus = 1 + this.player.dread01() * 0.8;
    const dmg = (20 + this.player.stats.hex * 3) * dreadBonus;

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.player.getDir().clone();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x9dff6a })
    );
    mesh.position.copy(origin).add(dir.clone().multiplyScalar(1.2));
    this.scene.add(mesh);
    const light = new THREE.PointLight(0x8dff6a, 1.4, 8, 2);
    mesh.add(light);
    this.bolts.push({ mesh, dir, dmg, life: 2.4 });
    this.player.recoilKick += 0.025;
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

    // advance hexbolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.mesh.position.add(b.dir.clone().multiplyScalar(38 * dt));
      b.life -= dt;
      const hit = this.enemies.boltHit(b.mesh.position, 1.0);
      if (hit || b.life <= 0) {
        if (hit) { this.enemies.applyDamage(hit, b.dmg, b.mesh.position, 'witchfire', false); this._hitmarker(); }
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }
}
