// ============================================================
// world.js — Hallow County: terrain, atmosphere, regions, and
// every hand-placed Halloween prop. One seamless streaming world.
// ============================================================
import * as THREE from 'three';
import { makeRng, randRange, randInt, pick, clamp, lerp, dist2D, TAU } from './utils.js';

// Region metadata drives the HUD label, fog tint and ambient wind.
export const REGIONS = [
  { id: 'gravewick',  name: 'GRAVEWICK',          x: 0,    z: 0,    r: 120, fog: 0x12161f, wind: 0.10 },
  { id: 'jackfield',  name: 'JACKFIELD ACRES',    x: 320,  z: -120, r: 200, fog: 0x1a1206, wind: 0.16 },
  { id: 'mournwood',  name: 'MOURNWOOD FOREST',   x: -300, z: 180,  r: 200, fog: 0x0c130d, wind: 0.13 },
  { id: 'gallowsfen', name: 'GALLOWSFEN',         x: 60,   z: 360,  r: 180, fog: 0x0e1414, wind: 0.09 },
  { id: 'ashfall',    name: 'ASHFALL WORKS',      x: -320, z: -260, r: 170, fog: 0x14100e, wind: 0.14 },
  { id: 'thousand',   name: 'THE THOUSAND-JACK',  x: 520,  z: -300, r: 130, fog: 0x200a04, wind: 0.20 },
];

export class World {
  constructor(scene, seed = 1031) {
    this.scene = scene;
    this.rng = makeRng(seed);
    this.colliders = [];          // {minX,maxX,minZ,maxZ} blocking boxes
    this.interactables = [];      // populated by items.js
    this.glows = [];              // {pos,color,base,phase,drift} candidate light sources
    this.lightPool = [];          // fixed pool of real PointLights (distance-culled)
    this.POOL = 10;
    this.scarecrowProps = [];     // static scarecrows that "watch" you
    this.WORLD = 900;             // half-extent of the playable county
    this._t = 0;
    this._glowTex = this._makeGlowTexture();
  }

  // soft radial sprite so every pumpkin reads as a glow without a real light
  _makeGlowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,200,120,0.7)');
    grd.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }

  // soft cloudy texture for drifting ground mist
  _makeMistTexture() {
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      const x = this.rng() * s, y = this.rng() * s, r = 20 + this.rng() * 70;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + this.rng() * 0.08;
      grd.addColorStop(0, `rgba(150,170,200,${a})`);
      grd.addColorStop(1, 'rgba(150,170,200,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // register a cheap glow: emissive sprite halo + candidacy for the light pool
  _addGlow(x, y, z, color = 0xff7a1e, base = 1.0, opts = {}) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTex, color, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    spr.position.set(x, y, z);
    spr.scale.setScalar(opts.size ?? 2.4);
    this.scene.add(spr);
    const glow = { pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), base,
      phase: this.rng() * TAU, sprite: spr, drift: opts.drift || null };
    this.glows.push(glow);
    return glow;
  }

  _buildLightPool() {
    for (let i = 0; i < this.POOL; i++) {
      const L = new THREE.PointLight(0xff7a1e, 0, 16, 2);
      this.scene.add(L);
      this.lightPool.push(L);
    }
  }

  // ---- Analytic rolling terrain. Cheap, continuous getHeight(). ----
  getHeight(x, z) {
    let h = 0;
    h += Math.sin(x * 0.0065 + 1.3) * Math.cos(z * 0.0061 - 0.7) * 9;
    h += Math.sin(x * 0.018 - 0.4) * Math.cos(z * 0.016 + 2.1) * 3.2;
    h += Math.sin((x + z) * 0.0042) * 5.5;
    h += Math.cos(x * 0.033) * Math.sin(z * 0.029) * 1.1;
    // Flatten a bowl around Gravewick spawn so the town reads as town.
    const d = dist2D(x, z, 0, 0);
    const flat = clamp(1 - d / 95, 0, 1);
    h *= (1 - flat * 0.85);
    // Gallowsfen sinks into black water.
    const fen = REGIONS[3];
    const fd = dist2D(x, z, fen.x, fen.z);
    if (fd < fen.r) h -= (1 - fd / fen.r) * 6;
    return h;
  }
  groundNormal(x, z) {
    const e = 1.2;
    const hl = this.getHeight(x - e, z), hr = this.getHeight(x + e, z);
    const hd = this.getHeight(x, z - e), hu = this.getHeight(x, z + e);
    return new THREE.Vector3(hl - hr, 2 * e, hd - hu).normalize();
  }

  regionAt(x, z) {
    let best = REGIONS[0], bestScore = -Infinity;
    for (const r of REGIONS) {
      const d = dist2D(x, z, r.x, r.z);
      const score = r.r - d;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  build() {
    this._sky();
    this._buildLightPool();
    this._terrain();
    this._water();
    this._atmosphere();
    this._horizon();
    this._gravewick();
    this._funeralHome();
    this._bellweatherHouse();
    this._jackfield();
    this._mournwood();
    this._ashfall();
    this._gallowsfen();
    this._thousandJack();
    this._scatterGraves();
    this._fenceLine();
    return this;
  }

  // ---------------- Atmosphere ----------------
  _sky() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x131826, 0.0065);
    scene.background = new THREE.Color(0x0a0c14);

    // Big inverted gradient dome.
    const geo = new THREE.SphereGeometry(1400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x05060d) }, bot: { value: new THREE.Color(0x241a2e) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
        void main(){ float t=clamp((normalize(vP).y+0.15)/0.8,0.0,1.0); gl_FragColor=vec4(mix(bot,top,t),1.0);} `,
    });
    scene.add(new THREE.Mesh(geo, mat));
    this.skyMat = mat;

    // Stars.
    const N = 1400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = this.rng(), v = this.rng();
      const th = u * TAU, ph = Math.acos(2 * v - 1);
      const rad = 1300;
      pos[i*3] = rad * Math.sin(ph) * Math.cos(th);
      pos[i*3+1] = Math.abs(rad * Math.cos(ph)) * 0.8 + 40;
      pos[i*3+2] = rad * Math.sin(ph) * Math.sin(th);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfd0ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.8 })));

    // The Blinking Moon — too big, slightly wrong colour.
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(70, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xf6e3b0 })
    );
    moon.position.set(-380, 360, -700);
    scene.add(moon);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(120, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.12, side: THREE.BackSide })
    );
    halo.position.copy(moon.position); scene.add(halo);
    this.moon = moon; this.moonHalo = halo;

    // Lighting: cold moon key + warm low fill so orange/blue contrast pops.
    const moonLight = new THREE.DirectionalLight(0xaec4ff, 0.95);
    moonLight.position.set(-380, 360, -700);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    const s = 160; const c = moonLight.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = 1; c.far = 1200;
    moonLight.shadow.bias = -0.0004;
    scene.add(moonLight); scene.add(moonLight.target);
    this.moonLight = moonLight;

    this.hemi = new THREE.HemisphereLight(0x2c3c5c, 0x1a120a, 0.55); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x2a3346, 0.45); scene.add(this.ambient);

    // ---- night-cycle + blood-moon state ----
    this.timeOfNight = 0.12;     // 0..1 around the eternal night
    this.danger = 1;             // enemy spawn multiplier
    this.bloodMoon = false;
    this._bloodCd = 150;         // first blood moon after a couple of minutes
    this._bloodT = 0;
    this._dayLen = 360;          // seconds per night loop
    this._baseFog = { color: 0x131826, density: 0.0065 };
  }

  _terrain() {
    const SIZE = this.WORLD * 2, SEG = 260;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x2e3322), cDry = new THREE.Color(0x4a3a1d), cFen = new THREE.Color(0x1c241f);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.getHeight(x, z);
      pos.setY(i, y);
      const reg = this.regionAt(x, z);
      let col = cGrass.clone();
      if (reg.id === 'jackfield' || reg.id === 'thousand') col.lerp(cDry, 0.6);
      if (reg.id === 'gallowsfen') col.lerp(cFen, 0.7);
      if (reg.id === 'ashfall') col.multiplyScalar(0.6);
      const n = (Math.sin(x * 0.7) * Math.cos(z * 0.7)) * 0.05 + 0.95;
      col.multiplyScalar(n);
      colors[i*3] = col.r; colors[i*3+1] = col.g; colors[i*3+2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.ground = mesh;

    // Leaf litter — drifting orange motes near the ground.
    const LN = 900, lp = new Float32Array(LN * 3);
    for (let i = 0; i < LN; i++) {
      const a = this.rng() * TAU, r = this.rng() * 260;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      lp[i*3] = x; lp[i*3+1] = this.getHeight(x, z) + this.rng() * 6 + 0.5; lp[i*3+2] = z;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    this.leaves = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xc4631e, size: 0.42, transparent: true, opacity: 0.42, map: this._glowTex, alphaTest: 0.08, depthWrite: false }));
    this.scene.add(this.leaves);
  }

  _water() {
    const fen = REGIONS[3];
    const g = new THREE.CircleGeometry(fen.r * 0.95, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x0a1412, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(fen.x, this.getHeight(fen.x, fen.z) - 1.5, fen.z);
    this.scene.add(mesh);
    this.waterMesh = mesh;
  }

  // drifting fog banks + rising embers for depth and mood
  _atmosphere() {
    this.mistTex = this._makeMistTexture();
    this.mistSprites = [];
    for (let i = 0; i < 46; i++) {
      const reg = pick(this.rng, REGIONS);
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r;
      const x = reg.x + Math.cos(a) * r, z = reg.z + Math.sin(a) * r;
      const dense = (reg.id === 'gallowsfen' || reg.id === 'mournwood' || reg.id === 'thousand');
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.mistTex, color: 0x9fb0c8, transparent: true,
        opacity: dense ? 0.3 : 0.16, depthWrite: false,
      }));
      const sc = randRange(this.rng, 12, 24);
      spr.scale.set(sc, sc * 0.5, 1);
      spr.position.set(x, this.getHeight(x, z) + randRange(this.rng, 1.4, 3.4), z);
      this.scene.add(spr);
      this.mistSprites.push({ spr, x, z, baseY: spr.position.y, ph: this.rng() * TAU, amp: randRange(this.rng, 1, 3) });
    }
    // rising ember motes
    const EN = 240, ep = new Float32Array(EN * 3);
    for (let i = 0; i < EN; i++) {
      const a = this.rng() * TAU, r = this.rng() * 130;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      ep[i * 3] = x; ep[i * 3 + 1] = this.getHeight(x, z) + this.rng() * 7 + 0.5; ep[i * 3 + 2] = z;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({
      map: this._glowTex, color: 0xffae5a, size: 0.5, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(this.embers);
  }

  // ---------------- Reusable prop builders ----------------
  placeOnGround(obj, x, z, yOff = 0) {
    obj.position.set(x, this.getHeight(x, z) + yOff, z);
    return obj;
  }
  addCollider(x, z, halfX, halfZ) {
    this.colliders.push({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ });
  }

  _jackolantern(x, z, scale = 1) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.55 * scale, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.5, metalness: 0.05, emissive: 0x4a1c00, emissiveIntensity: 0.6, envMapIntensity: 0.8 })
    );
    body.scale.y = 0.82; body.castShadow = true; grp.add(body);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.25), new THREE.MeshStandardMaterial({ color: 0x3c5a1e }));
    stem.position.y = 0.5 * scale; grp.add(stem);
    // glowing carved face (emissive planes)
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xffae3b });
    const eyeL = new THREE.Mesh(new THREE.ConeGeometry(0.1 * scale, 0.16 * scale, 3), faceMat);
    eyeL.position.set(-0.18 * scale, 0.08 * scale, 0.5 * scale); eyeL.rotation.x = Math.PI / 2; grp.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.18 * scale; grp.add(eyeR);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.34 * scale, 0.1 * scale, 0.05), faceMat);
    mouth.position.set(0, -0.15 * scale, 0.52 * scale); grp.add(mouth);

    this.placeOnGround(grp, x, z, 0.42 * scale);
    this.scene.add(grp);
    this._addGlow(grp.position.x, grp.position.y + 0.2, grp.position.z, 0xff7a1e, 1.1 * scale, { size: 2.2 * scale });
    return grp;
  }

  _tree(x, z, dead = true) {
    const grp = new THREE.Group();
    const h = randRange(this.rng, 5, 9);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.5, h, 6),
      new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 })
    );
    trunk.position.y = h / 2; trunk.castShadow = true; grp.add(trunk);
    const branches = randInt(this.rng, 3, 6);
    for (let i = 0; i < branches; i++) {
      const bl = randRange(this.rng, 1.5, 3.4);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, bl, 5),
        new THREE.MeshStandardMaterial({ color: 0x1f150e }));
      b.position.y = h * randRange(this.rng, 0.55, 0.95);
      b.rotation.z = randRange(this.rng, -1.1, 1.1);
      b.rotation.y = this.rng() * TAU;
      b.translateY(bl / 2); grp.add(b);
    }
    if (!dead) {
      const can = new THREE.Mesh(new THREE.IcosahedronGeometry(randRange(this.rng, 2, 3), 0),
        new THREE.MeshStandardMaterial({ color: 0x6b3a12, roughness: 1, flatShading: true }));
      can.position.y = h; can.castShadow = true; grp.add(can);
    }
    this.placeOnGround(grp, x, z, 0);
    grp.rotation.y = this.rng() * TAU;
    this.scene.add(grp);
    this.addCollider(x, z, 0.5, 0.5);
    return grp;
  }

  _gravestone(x, z) {
    const r = this.rng();
    let geo;
    if (r < 0.5) geo = new THREE.BoxGeometry(0.6, randRange(this.rng, 0.8, 1.4), 0.16);
    else { geo = new THREE.BoxGeometry(0.55, 1.1, 0.16); }
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 1 }));
    if (r >= 0.5) {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 12, 1, false, 0, Math.PI),
        m.material);
      top.rotation.z = Math.PI / 2; top.rotation.y = Math.PI / 2; top.position.y = 0.55; m.add(top);
    }
    m.castShadow = true;
    this.placeOnGround(m, x, z, (geo.parameters.height) / 2 - 0.1);
    m.rotation.y = randRange(this.rng, -0.25, 0.25);
    m.rotation.z = randRange(this.rng, -0.06, 0.06);
    this.scene.add(m);
    return m;
  }

  _scarecrow(x, z, menace = false) {
    const grp = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
    post.position.y = 1.3; grp.add(post);
    const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18 }));
    arms.rotation.z = Math.PI / 2; arms.position.y = 1.9; grp.add(arms);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: menace ? 0x4a3010 : 0x6b5424, roughness: 1, flatShading: true }));
    body.position.y = 1.55; body.castShadow = true; grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xc7a85a, roughness: 1, flatShading: true }));
    head.position.y = 2.15; head.scale.y = 1.2; head.castShadow = true; grp.add(head);
    // stitched eyes
    const em = new THREE.MeshBasicMaterial({ color: menace ? 0xff3010 : 0x120c04 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), em); e1.position.set(-0.1, 2.18, 0.22); grp.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.1; grp.add(e2);

    this.placeOnGround(grp, x, z, 0);
    grp.rotation.y = this.rng() * TAU;
    this.scene.add(grp);
    this.scarecrowProps.push({ grp, head, base: grp.rotation.y, x, z });
    return grp;
  }

  // Generic timber building w/ doorway, interior walls as colliders.
  _house(x, z, w, d, h, color = 0x37322b, rot = 0) {
    const grp = new THREE.Group();
    grp.position.set(x, this.getHeight(x, z), z);
    grp.rotation.y = rot;
    const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x20140c, roughness: 1 });
    const wallH = h;
    const mkWall = (px, pz, ww, dd) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, wallH, dd), wallMat);
      m.position.set(px, wallH / 2, pz); m.castShadow = true; m.receiveShadow = true; grp.add(m);
    };
    // front wall with a gap (doorway)
    const doorW = 1.6;
    mkWall(-(w/2 - (w/2 - doorW/2)/2), -d/2, (w - doorW)/2, 0.3); // left of door
    mkWall((w/2 - (w/2 - doorW/2)/2), -d/2, (w - doorW)/2, 0.3);  // right of door
    // lintel
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.4, wallH - 2.1, 0.3), wallMat);
    lintel.position.set(0, wallH - (wallH - 2.1)/2, -d/2); grp.add(lintel);
    mkWall(0, d/2, w, 0.3);
    mkWall(-w/2, 0, 0.3, d);
    mkWall(w/2, 0, 0.3, d);
    // roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.85, 2.6, 4),
      new THREE.MeshStandardMaterial({ color: 0x241712, roughness: 1 }));
    roof.position.y = wallH + 1.0; roof.rotation.y = Math.PI / 4; roof.castShadow = true; grp.add(roof);
    // window glow
    const winMat = new THREE.MeshBasicMaterial({ color: 0xff9b3a });
    [[-w/2 + 0.05, 0], [w/2 - 0.05, 0]].forEach(([wx]) => {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), winMat);
      win.position.set(wx, wallH * 0.55, 0); win.rotation.y = Math.PI/2; grp.add(win);
    });
    this.scene.add(grp);

    // Colliders in world space (rotation simplified to AABB footprint).
    const cs = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const fw = (w * cs + d * sn) / 2, fd = (w * sn + d * cs) / 2;
    // perimeter as four thin colliders so player can step through doorway
    this.addCollider(x, z - fd, fw, 0.3);
    this.addCollider(x, z + fd, fw, 0.3);
    this.addCollider(x - fw, z, 0.3, fd);
    this.addCollider(x + fw, z, 0.3, fd);
    return grp;
  }

  // ---------------- Regions ----------------
  _gravewick() {
    const houses = [
      [-26, -14, 9, 7], [22, -20, 8, 8], [30, 14, 7, 7],
      [-30, 16, 8, 6], [-8, 30, 7, 7], [16, 34, 8, 6], [-40, -2, 7, 8],
    ];
    for (const [hx, hz, w, d] of houses) {
      this._house(hx, hz, w, d, randRange(this.rng, 4.5, 5.5), 0x37322b, this.rng() * 0.4 - 0.2);
      // porch pumpkin
      this._jackolantern(hx + (this.rng() - 0.5) * 2, hz - d/2 - 1.2, randRange(this.rng, 0.8, 1.1));
    }
    // town square well + cluster of pumpkins
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 1 }));
    this.placeOnGround(well, 0, -2, 0.6); this.scene.add(well); this.addCollider(0, -2, 1.6, 1.6);
    for (let i = 0; i < 9; i++) {
      const a = this.rng() * TAU, r = randRange(this.rng, 4, 9);
      this._jackolantern(Math.cos(a) * r, -2 + Math.sin(a) * r, randRange(this.rng, 0.7, 1.2));
    }
    // a few dead trees + watchful scarecrow at the edge
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * TAU, r = randRange(this.rng, 55, 110);
      this._tree(Math.cos(a) * r, Math.sin(a) * r, this.rng() > 0.3);
    }
    this._scarecrow(44, 40);
    this._scarecrow(-52, -30, true);

    // Candlewick Manor — the Porcelain Count's house, on the wealthy edge
    this._house(96, -96, 16, 13, 8, 0x2c2630, Math.PI * 0.1);
    const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x10100f, metalness: 0.5, roughness: 0.6 }));
    this.placeOnGround(gate, 96, -88, 5); this.scene.add(gate);
    this._jackolantern(91, -89, 1.1); this._jackolantern(101, -89, 1.1);
  }

  _funeralHome() {
    // Larger, darker building NE of spawn — the opening dungeon exterior.
    const x = 0, z = -56;
    this._house(x, z, 14, 11, 6.5, 0x2b2722, 0);
    // black iron gate / sign
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4, 1.1, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x15110d }));
    this.placeOnGround(sign, x, z - 7, 4.4); this.scene.add(sign);
    // graves out front
    for (let i = 0; i < 14; i++) this._gravestone(x - 8 + (i % 7) * 2.4, z - 11 - Math.floor(i / 7) * 2.6);
    this.funeralHome = { x, z };
    this._jackolantern(x - 4, z - 6.5, 1.0);
    this._jackolantern(x + 4, z - 6.5, 1.0);
  }

  // Signature environmental-storytelling tableau (the empty thirteenth chair).
  _bellweatherHouse() {
    const x = -70, z = 70;
    this._house(x, z, 12, 12, 6, 0x322b2e, Math.PI * 0.15);
    // interior dining table set for thirteen
    const grp = new THREE.Group();
    grp.position.set(x, this.getHeight(x, z), z); grp.rotation.y = Math.PI * 0.15;
    const table = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 1 }));
    table.position.y = 0.9; grp.add(table);
    const ashMat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 1, emissive: 0x111111 });
    let chairIndex = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 6; i++) {
        const cx = -2.5 + i; const cz = side * 1.4;
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x241813 }));
        chair.position.set(cx, 0.6, cz); grp.add(chair);
        // 12 ash silhouettes; leave ONE chair empty (the thirteenth)
        if (chairIndex < 12) {
          const fig = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 8), ashMat);
          fig.position.set(cx, 1.5, cz - side * 0.1); grp.add(fig);
        }
        chairIndex++;
      }
    }
    // empty thirteenth chair at the head, with a small cold light over it
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1c120d }));
    head.position.set(3.4, 0.75, 0); grp.add(head);
    const cold = new THREE.PointLight(0x6fa0ff, 0.8, 6, 2); cold.position.set(3.4, 2.2, 0); grp.add(cold);
    this.scene.add(grp);
    this.bellweather = { x, z };
  }

  _jackfield() {
    const reg = REGIONS[1];
    // cornfield rows (instanced quads) + pumpkins + scarecrows
    const cornN = 1800;
    const stalk = new THREE.PlaneGeometry(0.25, 2.4);
    const cornMesh = new THREE.InstancedMesh(stalk,
      new THREE.MeshStandardMaterial({ color: 0x8a7a2a, roughness: 1, side: THREE.DoubleSide }), cornN);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
    let ci = 0;
    for (let i = 0; i < cornN; i++) {
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r;
      const x = reg.x + Math.cos(a) * r, z = reg.z + Math.sin(a) * r;
      const y = this.getHeight(x, z) + 1.2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng() * TAU);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, randRange(this.rng, 0.8, 1.3), 1));
      cornMesh.setMatrixAt(ci++, m);
    }
    cornMesh.count = ci; cornMesh.castShadow = true; this.scene.add(cornMesh); this.cornMesh = cornMesh;

    for (let i = 0; i < 60; i++) {
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r;
      this._jackolantern(reg.x + Math.cos(a) * r, reg.z + Math.sin(a) * r, randRange(this.rng, 0.7, 1.4));
    }
    for (let i = 0; i < 9; i++) {
      const a = this.rng() * TAU, r = randRange(this.rng, 30, reg.r);
      this._scarecrow(reg.x + Math.cos(a) * r, reg.z + Math.sin(a) * r, this.rng() > 0.5);
    }
    // Marrowbarn Farm — a barn at the field's heart
    this._house(reg.x, reg.z, 16, 12, 7, 0x401f14, 0.3);
  }

  _mournwood() {
    const reg = REGIONS[2];
    for (let i = 0; i < 220; i++) {
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r;
      this._tree(reg.x + Math.cos(a) * r, reg.z + Math.sin(a) * r, this.rng() > 0.4);
    }
    // witch hut + green witchfire light
    this._house(reg.x, reg.z, 7, 7, 4.5, 0x20281c, 0.7);
    this._addGlow(reg.x + 5, this.getHeight(reg.x + 5, reg.z + 4) + 1.2, reg.z + 4, 0x6dff5a, 1.4, { size: 3 });
    this._scarecrow(reg.x - 20, reg.z + 15, true);
  }

  _ashfall() {
    const reg = REGIONS[4];
    // smokestacks + boxy factory
    this._house(reg.x, reg.z, 22, 16, 9, 0x2a2622, 0.1);
    // Harrow & Sons Toyworks — the doll factory you can enter (door at -360,-240)
    this._house(-360, -240, 14, 11, 7, 0x322018, 0);
    this._jackolantern(-360, -246, 0.9);
    for (let i = 0; i < 3; i++) {
      const sx = reg.x - 8 + i * 8, sz = reg.z - 10;
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 16, 10),
        new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 1 }));
      this.placeOnGround(stack, sx, sz, 8); this.scene.add(stack); this.addCollider(sx, sz, 1.8, 1.8);
      this._addGlow(sx, this.getHeight(sx, sz) + 16, sz, 0xff4a1e, 0.9, { size: 4 });
    }
    // rusted machinery debris
    for (let i = 0; i < 18; i++) {
      const a = this.rng() * TAU, r = randRange(this.rng, 12, reg.r * 0.8);
      const box = new THREE.Mesh(new THREE.BoxGeometry(randRange(this.rng,1,3), randRange(this.rng,1,2.5), randRange(this.rng,1,3)),
        new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1, metalness: 0.3 }));
      this.placeOnGround(box, reg.x + Math.cos(a)*r, reg.z + Math.sin(a)*r, 0.8);
      box.rotation.y = this.rng() * TAU; this.scene.add(box);
    }
  }

  _gallowsfen() {
    const reg = REGIONS[3];
    // crooked dead trees in black water + drifting marsh lights
    for (let i = 0; i < 80; i++) {
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r;
      const x = reg.x + Math.cos(a) * r, z = reg.z + Math.sin(a) * r;
      this._tree(x, z, true);
    }
    for (let i = 0; i < 14; i++) {
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r * 0.8;
      const x = reg.x + Math.cos(a) * r, z = reg.z + Math.sin(a) * r;
      const y = this.getHeight(x, z) + randRange(this.rng, 1.5, 3);
      this._addGlow(x, y, z, 0x8dff6a, 0.8, { size: 2.2, drift: { x, z, a: this.rng() * TAU } });
    }
  }

  // Boss arena — a clearing ringed by a thousand carved faces.
  _thousandJack() {
    const reg = REGIONS[5];
    for (let i = 0; i < 120; i++) {
      const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * reg.r;
      this._jackolantern(reg.x + Math.cos(a) * r, reg.z + Math.sin(a) * r, randRange(this.rng, 0.6, 1.6));
    }
    // ring of dead trees marking the arena edge
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      this._tree(reg.x + Math.cos(a) * (reg.r * 0.7), reg.z + Math.sin(a) * (reg.r * 0.7), true);
    }
    this.bossArena = { x: reg.x, z: reg.z, r: reg.r * 0.6 };
  }

  _scatterGraves() {
    // graves drift across the whole county; Bethesda "there's always one more"
    for (let i = 0; i < 120; i++) {
      const x = randRange(this.rng, -this.WORLD, this.WORLD);
      const z = randRange(this.rng, -this.WORLD, this.WORLD);
      if (dist2D(x, z, 0, 0) < 40) continue;
      const reg = this.regionAt(x, z);
      if (reg.id === 'gallowsfen') continue;
      if (this.rng() > 0.6) this._gravestone(x, z);
    }
  }

  _fenceLine() {
    // black iron fence loosely ringing Gravewick
    const N = 64, R = 100;
    const mat = new THREE.MeshStandardMaterial({ color: 0x0d0d10, metalness: 0.4, roughness: 0.7 });
    const geo = new THREE.BoxGeometry(0.08, 1.6, 0.08);
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      m.makeTranslation(x, this.getHeight(x, z) + 0.8, z);
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = true; this.scene.add(inst);
  }

  // ---------------- Per-frame ----------------
  // A distant, fog-free horizon of region silhouettes, built in-engine to match
  // the low-poly night look. It follows the camera so it reads as infinitely far
  // — it rotates as you turn but never slides as you walk, and sits behind all
  // real geometry. This is the honest version of a "painted backdrop": a true
  // horizon, not a flat billboard that breaks the moment you move.
  _horizon() {
    const R = 1150, g = new THREE.Group();
    const sil = (color) => new THREE.MeshBasicMaterial({ color, fog: false });
    const glow = (color, op = 0.7) => new THREE.SpriteMaterial({ map: this._glowTex, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const at = (az, build) => {
      const n = new THREE.Group();
      n.position.set(Math.cos(az) * R, 0, Math.sin(az) * R);
      n.rotation.y = -az + Math.PI / 2;
      build(n); g.add(n);
    };
    const box = (n, w, h, d, x, z, color, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), sil(color));
      m.position.set(x, h / 2, z); m.rotation.y = ry; n.add(m); return m;
    };
    const cone = (n, r, h, x, z, color) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), sil(color));
      m.position.set(x, h / 2, z); n.add(m); return m;
    };
    const dot = (n, x, y, z, color, s = 5) => {
      const sp = new THREE.Sprite(glow(color)); sp.scale.setScalar(s); sp.position.set(x, y, z); n.add(sp);
    };

    // 1 · the far cathedral city you can see but never reach (Hallowind proper)
    at(-1.45, (n) => {
      const c = 0x0b0a15;
      for (let i = 0; i < 9; i++) box(n, randRange(this.rng, 9, 16), randRange(this.rng, 55, 120), 12, (i - 4) * 22, randRange(this.rng, -12, 12), c);
      for (const sx of [-16, 16]) { box(n, 20, 150, 18, sx, -6, c); cone(n, 13, 46, sx, -6, c).position.y = 173; }
      for (let i = 0; i < 16; i++) dot(n, randRange(this.rng, -92, 92), randRange(this.rng, 16, 92), 6, 0xffb060, randRange(this.rng, 3, 6));
    });
    // 2 · Mournwood treeline
    at(2.45, (n) => {
      for (let i = 0; i < 16; i++) cone(n, randRange(this.rng, 5, 9), randRange(this.rng, 26, 66), (i - 8) * 13, randRange(this.rng, -10, 10), 0x070c09);
    });
    // 3 · Ashfall Works — mill block + smokestacks with ember tops
    at(3.7, (n) => {
      const c = 0x110c0a;
      box(n, 80, 46, 30, 0, 0, c); box(n, 40, 64, 24, -34, 6, c);
      for (const sx of [-18, 6, 30]) { box(n, 9, randRange(this.rng, 80, 116), 9, sx, -10, c); dot(n, sx, 100, -10, 0xff7a2a, 6); }
    });
    // 4 · the Thousand-Jack hill, crowned with a great lantern
    at(-0.35, (n) => {
      cone(n, 90, 70, 0, 0, 0x0c0a11);
      const jack = new THREE.Mesh(new THREE.SphereGeometry(16, 12, 10), sil(0x140a06)); jack.position.set(0, 76, 0); n.add(jack);
      dot(n, 0, 76, 0, 0xff8a1e, 26);
    });
    // 5 · Gallowsfen — a drowned, tilted church
    at(1.15, (n) => {
      const c = 0x0a0f11;
      box(n, 46, 34, 22, 0, 0, c, 0.06); box(n, 14, 70, 14, 22, -4, c, 0.16);
      dot(n, 22, 54, -4, 0x6fa0ff, 7);
    });
    // 6 · Jackfield — a far farmhouse and windmill
    at(0.4, (n) => {
      const c = 0x120d07;
      box(n, 40, 36, 26, 0, 0, c, 0.1); box(n, 8, 70, 8, 30, -6, c);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(22, 22, 3), sil(c)); hub.position.set(30, 64, -6); hub.rotation.z = 0.6; n.add(hub);
      dot(n, 0, 20, 13, 0xffb060, 5); dot(n, -8, 14, 13, 0xffb060, 4);
    });

    this.horizon = g;
    this.scene.add(g);
  }

  update(dt, playerPos) {
    this._t += dt;
    this.updateNight(dt);
    // keep the horizon centred on the camera so it reads as infinitely far
    if (this.horizon && playerPos) this.horizon.position.set(playerPos.x, 0, playerPos.z);
    this._updateLightPool(dt, playerPos);
    // drift leaf litter with the wind, recycling around the player
    if (this.leaves) {
      const p = this.leaves.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) + dt * 2.2, y = p.getY(i) - dt * 0.6, z = p.getZ(i) + dt * 0.8;
        if (y < this.getHeight(x, z)) { y += 7; }
        if (dist2D(x, z, playerPos.x, playerPos.z) > 130) { x = playerPos.x + (this.rng()-0.5)*60; z = playerPos.z + (this.rng()-0.5)*60; y = playerPos.y + 6; }
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
    }
    // drifting mist banks (gentle bob + slow horizontal sway)
    if (this.mistSprites) {
      for (const m of this.mistSprites) {
        m.ph += dt * 0.25;
        m.spr.position.y = m.baseY + Math.sin(m.ph) * m.amp * 0.4;
        m.spr.position.x = m.x + Math.cos(m.ph * 0.5) * 3;
      }
    }
    // rising, recycling embers near the player
    if (this.embers) {
      const p = this.embers.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) + dt * 0.6, y = p.getY(i) + dt * (0.5 + (i % 5) * 0.15), z = p.getZ(i);
        if (y > this.getHeight(x, z) + 11 || dist2D(x, z, playerPos.x, playerPos.z) > 120) {
          x = playerPos.x + (this.rng() - 0.5) * 90; z = playerPos.z + (this.rng() - 0.5) * 90;
          y = this.getHeight(x, z) + this.rng() * 2;
        }
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
    }

    // the moon "blinks" rarely
    if (this.moon && Math.sin(this._t * 0.13) > 0.999) this.moon.scale.y = 0.05;
    else if (this.moon) this.moon.scale.y = 1;
  }

  // ground material under a point — drives footstep timbre
  surfaceAt(x, z) {
    if (dist2D(x, z, 0, 0) < 46) return 'stone';        // Gravewick cobbles
    const reg = this.regionAt(x, z);
    if (reg.id === 'gallowsfen') {
      if (dist2D(x, z, reg.x, reg.z) < reg.r * 0.9) return 'water';
      return 'mud';
    }
    if (reg.id === 'mournwood') return 'leaves';
    if (reg.id === 'ashfall') return 'metal';
    if (reg.id === 'jackfield' || reg.id === 'thousand') return 'dirt';
    return 'grass';
  }

  isBloodMoon() { return this.bloodMoon; }
  nightPhaseName() {
    const t = this.timeOfNight;
    if (this.bloodMoon) return "BLOOD MOON";
    if (t < 0.18) return 'Dusk';
    if (t < 0.5) return 'Deep Night';
    if (t < 0.72) return 'The Witching Hour';
    return 'False Dawn';
  }

  // Advance the eternal night; periodically a Blood Moon surges the dark.
  updateNight(dt) {
    if (this._interiorMuted) return;   // time holds its breath indoors
    this.timeOfNight = (this.timeOfNight + dt / this._dayLen) % 1;

    // blood-moon scheduling
    if (this.bloodMoon) {
      this._bloodT -= dt;
      if (this._bloodT <= 0) { this.bloodMoon = false; this._bloodCd = 160 + this.rng() * 120; if (this.onBloodMoon) this.onBloodMoon(false); }
    } else {
      this._bloodCd -= dt;
      if (this._bloodCd <= 0) { this.bloodMoon = true; this._bloodT = 32; if (this.onBloodMoon) this.onBloodMoon(true); }
    }

    // smooth blood factor for visuals
    this._blood = lerp(this._blood ?? 0, this.bloodMoon ? 1 : 0, 1 - Math.pow(0.06, dt));
    const b = this._blood;
    this.danger = 1 + b * 1.4;

    // moon colour & arc — drifts across the sky over the night
    const ang = this.timeOfNight * TAU;
    const mx = Math.cos(ang) * 760, my = 200 + Math.sin(ang) * 320, mz = -700;
    if (this.moon) {
      this.moon.position.set(mx, Math.max(120, my), mz);
      this.moonHalo.position.copy(this.moon.position);
      this.moon.material.color.setRGB(lerp(0.96, 0.85, b), lerp(0.89, 0.13, b), lerp(0.69, 0.10, b));
      this.moonHalo.material.color.copy(this.moon.material.color);
      this.moonHalo.material.opacity = 0.12 + b * 0.25;
    }
    // moonlight follows the moon; reddens & brightens at blood moon
    if (this.moonLight) {
      this.moonLight.position.set(mx, Math.max(120, my), mz);
      this.moonLight.target.position.set(0, 0, 0);
      this.moonLight.color.setRGB(lerp(0.68, 1.0, b), lerp(0.77, 0.32, b), lerp(1.0, 0.28, b));
      // dimmer at false dawn, brighter at blood moon
      const dawnDim = this.timeOfNight > 0.72 ? 0.7 : 1;
      this.moonLight.intensity = (0.95 * dawnDim) + b * 0.5;
    }
    if (this.hemi) this.hemi.intensity = 0.55 + b * 0.25;
    // sky + fog tint
    if (this.skyMat) {
      this.skyMat.uniforms.bot.value.setRGB(lerp(0.14, 0.32, b), lerp(0.10, 0.03, b), lerp(0.18, 0.05, b));
    }
    // only override fog while the blood moon is bleeding in, so per-region
    // fog tints (set on region change) survive ordinary nights
    if (this.scene.fog && b > 0.02) {
      const f = this.scene.fog.color;
      f.setRGB(lerp(f.r, 0.20, b * 0.6), lerp(f.g, 0.03, b * 0.6), lerp(f.b, 0.05, b * 0.6));
    }
  }

  // Assign the fixed light pool to the nearest glow points, so cost stays
  // constant no matter how many pumpkins dot the county.
  _updateLightPool(dt, playerPos) {
    const flick = (phase) => 0.78 + Math.sin(this._t * 9 + phase) * 0.12 + Math.sin(this._t * 23 + phase) * 0.08;
    // animate drifting wisps + sprite shimmer
    for (const g of this.glows) {
      if (g.drift) {
        g.drift.a += dt * 0.3;
        g.pos.x = g.drift.x + Math.cos(g.drift.a) * 4;
        g.pos.z = g.drift.z + Math.sin(g.drift.a) * 4;
        g.sprite.position.copy(g.pos);
      }
      if (g.sprite) g.sprite.material.opacity = 0.4 * flick(g.phase) + 0.15;
    }
    // indoors: the overworld glows don't reach; let interior lights carry the room
    if (playerPos && this._interiorMuted) { for (const L of this.lightPool) L.intensity = 0; return; }

    // find nearest POOL glow points (simple partial selection, cheap enough)
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;
    const cand = this.glows;
    // compute squared distances and pick nearest POOL via a small insertion list
    const best = this._poolScratch || (this._poolScratch = []);
    best.length = 0;
    for (let i = 0; i < cand.length; i++) {
      const g = cand[i];
      const dx = g.pos.x - px, dz = g.pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 70 * 70) continue;
      if (best.length < this.POOL) { best.push({ g, d2 }); best.sort((a, b) => a.d2 - b.d2); }
      else if (d2 < best[this.POOL - 1].d2) { best[this.POOL - 1] = { g, d2 }; best.sort((a, b) => a.d2 - b.d2); }
    }
    for (let i = 0; i < this.POOL; i++) {
      const L = this.lightPool[i];
      if (i < best.length) {
        const g = best[i].g;
        L.position.copy(g.pos);
        L.color.copy(g.color);
        L.distance = 18;
        L.intensity = g.base * flick(g.phase);
      } else L.intensity = 0;
    }
  }

  setInteriorMuted(v) {
    this._interiorMuted = v;
    for (const L of this.lightPool) L.visible = !v;   // drop them from the shader indoors
  }

  // resolve player XZ against box colliders (called from player.js)
  collide(px, pz, radius = 0.5) {
    for (const c of this.colliders) {
      if (px > c.minX - radius && px < c.maxX + radius && pz > c.minZ - radius && pz < c.maxZ + radius) {
        // push out along the smallest axis of penetration
        const dl = px - (c.minX - radius), dr = (c.maxX + radius) - px;
        const db = pz - (c.minZ - radius), dtp = (c.maxZ + radius) - pz;
        const mx = Math.min(dl, dr), mz = Math.min(db, dtp);
        if (mx < mz) px = dl < dr ? c.minX - radius : c.maxX + radius;
        else pz = db < dtp ? c.minZ - radius : c.maxZ + radius;
      }
    }
    return [px, pz];
  }
}
