import * as THREE from 'three';
import {
  BLOCKS, T, MAP, MIN_Y, WATER_Y, LAKE, ZONES, key, parseKey, inLake, zoneAt, generate,
  generateLandChunk, biomeAt, WORLD_LIMIT, LAND_VOIDS, inLandVoid,
} from './world.js';
import { account, joinRoom } from './online.js';

const BUILD_PALETTE = [T.STONE, T.WOOD, T.RED, T.BLUE, T.YELLOW, T.WHITE, T.BLACK, T.PURPLE, T.ORANGE, T.SAND, T.FERUZA, T.BRICK];
const SHIRT_COLORS = [0x1e88e5, 0xe53935, 0x43a047, 0x8e24aa, 0xfb8c00, 0x222222, 0xf06292];
const SAVE_KEY = 'roblok.save.v2';
const OLD_SAVE_KEY = 'roblok.save.v1';

// ---------- Save ----------
function readJSON(k) {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
const save = Object.assign({
  name: '', shirt: 0, coins: 0, added: {}, removed: [], cp: null, done: {}, kills: 0, sound: true, gfx: 'high', diff: 'orta',
}, readJSON(SAVE_KEY) || {});
if (!readJSON(SAVE_KEY)) {
  // Carry the name, colour and Roblon over from v0.1; its world edits no longer fit the new map
  const old = readJSON(OLD_SAVE_KEY);
  if (old) { save.name = old.name || ''; save.shirt = old.shirt || 0; save.coins = old.coins || 0; }
}
let saveTimer = 0;
let offlineCoins = null; // set while online: account Roblon live in save.coins, the phone's own are kept here
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = offlineCoins === null ? save : Object.assign({}, save, { coins: offlineCoins });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }, 300);
}

// ---------- World ----------
const gen = generate();
const world = gen.world;
const baseWorld = new Map(world);
// The obby floats over open sky east of the map; keep the endless land away from it
LAND_VOIDS.push([MAP, -22, Math.max(...gen.finishes.map((f) => f.area[3])) + 12, 22]);
const inObby = (p) => inLandVoid(Math.floor(p.x), Math.floor(p.z));
for (const k of save.removed) world.delete(Number(k));
for (const k in save.added) world.set(Number(k), save.added[k]);
save.removed = save.removed.map(Number);

const isSolid = (x, y, z) => world.has(key(Math.floor(x), Math.floor(y), Math.floor(z)));

// ---------- Renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const SKY = 0x8fcaff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 150);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x5a6b45, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 140 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

let viewDist = 120;
function applyGraphics() {
  const high = save.gfx === 'high';
  renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
  renderer.shadowMap.enabled = high;
  sun.castShadow = high;
  viewDist = high ? 120 : 75;
  scene.fog.far = viewDist + 20;
  scene.fog.near = viewDist * 0.55;
  scene.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
  });
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function makeBlockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 64, Math.random() * 64, 3, 3);
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 4; g.strokeRect(2, 2, 60, 60);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.strokeRect(6, 6, 52, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- Chunked block rendering ----------
const CHUNK = 16;
const chunkKey = (x, z) => (Math.floor(x / CHUNK) + 128) * 256 + (Math.floor(z / CHUNK) + 128);
const chunkBlocks = new Map();
const chunkMeshes = new Map();
const dirtyChunks = new Set();
const blockGeo = new THREE.BoxGeometry(1, 1, 1);
const blockMat = new THREE.MeshLambertMaterial({ map: makeBlockTexture() });
const tmpMat = new THREE.Matrix4();
const tmpColor = new THREE.Color();

function indexBlock(k) {
  const [x, , z] = parseKey(k);
  const ck = chunkKey(x, z);
  let s = chunkBlocks.get(ck);
  if (!s) { s = new Set(); chunkBlocks.set(ck, s); }
  s.add(k);
}
for (const k of world.keys()) indexBlock(k);

function exposed(x, y, z) {
  return !world.has(key(x + 1, y, z)) || !world.has(key(x - 1, y, z)) || !world.has(key(x, y + 1, z))
    || (y > MIN_Y && !world.has(key(x, y - 1, z))) || !world.has(key(x, y, z + 1)) || !world.has(key(x, y, z - 1));
}

function buildChunk(ck) {
  const set = chunkBlocks.get(ck);
  const list = [];
  if (set) for (const k of set) {
    const [x, y, z] = parseKey(k);
    if (exposed(x, y, z)) list.push(k);
  }
  let mesh = chunkMeshes.get(ck);
  if (!mesh || mesh.instanceMatrix.count < list.length) {
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(blockGeo, blockMat, list.length + 48);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    chunkMeshes.set(ck, mesh);
    scene.add(mesh);
  }
  list.forEach((k, i) => {
    const [x, y, z] = parseKey(k);
    tmpMat.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
    mesh.setMatrixAt(i, tmpMat);
    mesh.setColorAt(i, tmpColor.setHex(BLOCKS[world.get(k)].color));
  });
  mesh.count = list.length;
  mesh.userData.keys = list;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}
for (const ck of chunkBlocks.keys()) buildChunk(ck);

function markDirty(x, z) {
  dirtyChunks.add(chunkKey(x, z));
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dirtyChunks.add(chunkKey(x + dx, z + dz));
}
function setBlockAt(x, y, z, t) {
  const k = key(x, y, z);
  if (t === null) {
    world.delete(k);
    chunkBlocks.get(chunkKey(x, z))?.delete(k);
  } else {
    world.set(k, t);
    indexBlock(k);
  }
  markDirty(x, z);
}
function flushChunks() {
  for (const ck of dirtyChunks) if (chunkBlocks.has(ck)) buildChunk(ck);
  dirtyChunks.clear();
}
let cullTimer = 0;
function cullChunks(px, pz) {
  for (const [ck, mesh] of chunkMeshes) {
    const cx = (Math.floor(ck / 256) - 128) * CHUNK + CHUNK / 2;
    const cz = ((ck % 256) - 128) * CHUNK + CHUNK / 2;
    mesh.visible = Math.hypot(cx - px, cz - pz) < viewDist + CHUNK;
  }
}

// ---------- Decorations ----------
const water = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48),
  new THREE.MeshLambertMaterial({ color: 0x2a8fd8, transparent: true, opacity: 0.72, depthWrite: false }),
);
water.rotation.x = -Math.PI / 2;
water.scale.set(LAKE.rx + 0.6, LAKE.rz + 0.6, 1);
water.position.set(LAKE.x + 0.5, WATER_Y, LAKE.z + 0.5);
scene.add(water);

// ---------- Endless land: chunks beyond the hand-made map appear as the player walks out ----------
const landDone = new Set();       // chunk keys already generated (or part of the base map)
const landWater = new Set();      // column keys covered by water
const landColors = new Map();     // column key -> minimap colour
const colKey = (x, z) => (x + 1024) * 2048 + (z + 1024);
const isLandWater = (x, z) => landWater.has(colKey(Math.floor(x), Math.floor(z)));
const CH0 = -MAP / CHUNK, CH1 = MAP / CHUNK - 1; // base map chunk range
for (let cx = CH0; cx <= CH1; cx++) for (let cz = CH0; cz <= CH1; cz++) landDone.add((cx + 128) * 256 + (cz + 128));
const CH_LIMIT = Math.floor(WORLD_LIMIT / CHUNK);
function generateLand(cx, cz) {
  const lk = (cx + 128) * 256 + (cz + 128);
  landDone.add(lk);
  const out = generateLandChunk(cx, cz);
  const removed = online ? null : new Set(save.removed);
  const b = out.blocks;
  for (let i = 0; i < b.length; i += 2) {
    const k = b[i];
    // Never cover what is already there (the base map, a neighbour's tree) or what a player removed
    if (world.has(k) || (online ? onlineEdits.has(k) : removed.has(k))) continue;
    world.set(k, b[i + 1]);
    indexBlock(k);
  }
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  markDirty(x0, z0); markDirty(x0 + CHUNK - 1, z0 + CHUNK - 1);
  if (out.water.length) {
    const g = [];
    for (let i = 0; i < out.water.length; i += 2) {
      const x = out.water[i], z = out.water[i + 1];
      landWater.add(colKey(x, z));
      g.push(x, WATER_Y, z, x, WATER_Y, z + 1, x + 1, WATER_Y, z + 1, x, WATER_Y, z, x + 1, WATER_Y, z + 1, x + 1, WATER_Y, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
    geo.computeVertexNormals();
    const wm = new THREE.Mesh(geo, water.material);
    wm.userData.landWater = true;
    scene.add(wm);
    landWaterMeshes.push(wm);
  }
  for (let i = 0; i < out.colors.length; i += 3) landColors.set(colKey(out.colors[i], out.colors[i + 1]), out.colors[i + 2]);
  for (const c of out.coins) coins.push(makeCoin(c));
  for (const e of out.enemies) enemies.push(new Enemy(e.type, e.pos));
}
const landWaterMeshes = [];
let landTimer = 0;
function updateLand(px, pz, budget) {
  // Generate the nearest missing chunks around the player, a few per frame to avoid stutter
  const r = Math.ceil(Math.min(viewDist, 100) / CHUNK) + 1;
  const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
  const todo = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const cx = pcx + dx, cz = pcz + dz;
    if (Math.abs(cx) > CH_LIMIT || Math.abs(cz) > CH_LIMIT || dx * dx + dz * dz > r * r) continue;
    if (!landDone.has((cx + 128) * 256 + (cz + 128))) todo.push([dx * dx + dz * dz, cx, cz]);
  }
  todo.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(budget, todo.length); i++) generateLand(todo[i][1], todo[i][2]);
  return todo.length;
}

const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
const clouds = [];
for (let i = 0; i < 24; i++) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(8 + Math.random() * 12, 2, 5 + Math.random() * 8), cloudMat);
  c.position.set(-160 + Math.random() * 380, 45 + Math.random() * 12, -160 + Math.random() * 320);
  scene.add(c); clouds.push(c);
}

const flagCloths = [];
for (const [x, y, z] of gen.flags) {
  const f = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.y = 2;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.06), new THREE.MeshLambertMaterial({ color: 0xe53935 }));
  cloth.position.set(0.8, 3.4, 0);
  f.add(pole, cloth);
  f.position.set(x, y, z);
  scene.add(f);
  flagCloths.push(cloth);
}

// ---------- Labels ----------
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function makeLabel(text, opts = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `bold ${opts.size || 40}px system-ui, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = 64;
  g.font = font;
  if (opts.bubble) {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(g, 0, 0, w, 64, 18); g.fill();
    g.fillStyle = '#111';
  } else {
    g.fillStyle = 'rgba(0,0,0,0.38)';
    roundRect(g, 0, 6, w, 52, 14); g.fill();
    g.fillStyle = opts.color || '#fff';
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: !opts.noFog }));
  const scale = opts.scale || 0.012;
  s.scale.set(w * scale, 64 * scale, 1);
  return s;
}
for (const l of gen.labels) {
  const s = makeLabel(l.text, { color: l.color, scale: l.small ? 0.016 : 0.028 });
  s.position.set(...l.pos);
  scene.add(s);
}

// ---------- Particles ----------
const particles = [];
const particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
function burst(pos, color, n = 12, speed = 5) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(particleGeo, mat);
    m.position.copy(pos);
    scene.add(m);
    particles.push({
      m, life: 0.6 + Math.random() * 0.3,
      v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed),
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.v.y -= 15 * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.scale.setScalar(Math.max(0.01, p.life * 1.5));
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
}

// ---------- Sound ----------
let actx = null;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
}
const SFX = {
  jump: [[330, 520, 0.12, 'square', 0.04]],
  coin: [[880, 1320, 0.09, 'triangle', 0.09], [1320, 1760, 0.12, 'triangle', 0.07, 0.07]],
  build: [[200, 140, 0.08, 'square', 0.05]],
  break: [[160, 60, 0.12, 'sawtooth', 0.05]],
  swing: [[600, 200, 0.12, 'sawtooth', 0.03]],
  hit: [[220, 90, 0.12, 'square', 0.08]],
  hurt: [[180, 80, 0.25, 'sawtooth', 0.08]],
  pad: [[300, 900, 0.25, 'triangle', 0.07]],
  kill: [[500, 120, 0.3, 'square', 0.07], [800, 1600, 0.2, 'triangle', 0.06, 0.15]],
  win: [[523, 523, 0.15, 'triangle', 0.08], [659, 659, 0.15, 'triangle', 0.08, 0.15], [784, 784, 0.15, 'triangle', 0.08, 0.3], [1046, 1046, 0.35, 'triangle', 0.08, 0.45]],
  die: [[400, 60, 0.6, 'sawtooth', 0.08]],
};
function sfx(name) {
  if (!save.sound || !actx) return;
  const now = actx.currentTime;
  for (const [f0, f1, d, type, vol, delay = 0] of SFX[name]) {
    const o = actx.createOscillator(), g = actx.createGain();
    const t = now + delay;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + d);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + d + 0.02);
  }
}

// ---------- Avatar ----------
const SKIN = 0xf5cd47;
function makeFaceTexture(skin, eyes) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#' + skin.toString(16).padStart(6, '0'); g.fillRect(0, 0, 64, 64);
  g.fillStyle = eyes;
  g.beginPath(); g.ellipse(22, 26, 4, 6, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(42, 26, 4, 6, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = eyes === '#111' ? '#111' : '#000'; g.lineWidth = 3;
  g.beginPath();
  if (eyes === '#111') g.arc(32, 36, 12, 0.15 * Math.PI, 0.85 * Math.PI);
  else { g.moveTo(20, 46); g.lineTo(44, 42); }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const happyFace = makeFaceTexture(SKIN, '#111');
const evilFace = makeFaceTexture(0x7a7f87, '#ff2a2a');

class Avatar {
  constructor(name, shirtColor, opts = {}) {
    this.group = new THREE.Group();
    const skin = opts.evil ? 0x7a7f87 : SKIN;
    this.mats = [
      new THREE.MeshLambertMaterial({ color: shirtColor }),
      new THREE.MeshLambertMaterial({ color: skin }),
      new THREE.MeshLambertMaterial({ map: opts.evil ? evilFace : happyFace }),
      new THREE.MeshLambertMaterial({ color: opts.evil ? 0x1b1b1b : 0x2b3a67 }),
    ];
    const [shirtMat, skinMat, faceMat, pantsMat] = this.mats;
    this.shirtMat = shirtMat;
    const part = (w, h, d, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = true;
      return m;
    };
    const torso = part(0.95, 0.8, 0.5, shirtMat); torso.position.y = 1.2;
    const head = part(0.6, 0.6, 0.6, [skinMat, skinMat, skinMat, skinMat, faceMat, skinMat]); head.position.y = 1.92;
    const limb = (x, y, mat) => {
      const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
      const m = part(0.44, 0.8, 0.44, mat); m.position.y = -0.4;
      pivot.add(m); return pivot;
    };
    this.legL = limb(-0.24, 0.8, pantsMat);
    this.legR = limb(0.24, 0.8, pantsMat);
    this.armL = limb(-0.7, 1.58, skinMat);
    this.armR = limb(0.7, 1.58, skinMat);
    for (const arm of [this.armL, this.armR]) {
      const sleeve = part(0.46, 0.34, 0.46, shirtMat); sleeve.position.y = -0.16; arm.add(sleeve);
    }
    if (opts.helmet) {
      const helm = part(0.68, 0.3, 0.68, pantsMat); helm.position.y = 2.2;
      this.helmet = helm;
    }
    if (opts.sword) {
      const blade = part(0.1, 1.1, 0.22, new THREE.MeshLambertMaterial({ color: opts.evil ? 0x8a1c1c : 0xd8dee9 }));
      blade.position.set(0, -0.85, 0.6); blade.rotation.x = Math.PI / 2;
      const hilt = part(0.14, 0.14, 0.4, new THREE.MeshLambertMaterial({ color: 0x6d4c1f }));
      hilt.position.set(0, -0.8, 0.1);
      this.armR.add(blade, hilt);
    }
    this.body = new THREE.Group();
    this.body.add(torso, head, this.legL, this.legR, this.armL, this.armR);
    if (this.helmet) this.body.add(this.helmet);
    this.scale = 0.85 * (opts.scale || 1);
    this.body.scale.setScalar(this.scale);
    this.group.add(this.body);
    this.label = makeLabel(name, { color: opts.labelColor || '#ffffff' });
    this.label.position.y = 2.3 * (opts.scale || 1);
    this.group.add(this.label);
    this.bubble = null; this.bubbleTime = 0;
    this.phase = 0; this.facing = 0; this.attackT = 0; this.flashT = 0;
    scene.add(this.group);
  }
  say(text) {
    if (this.bubble) { this.group.remove(this.bubble); this.bubble.material.map.dispose(); }
    this.bubble = makeLabel(text, { bubble: true, size: 34, scale: 0.011 });
    this.bubble.position.y = this.label.position.y + 0.65;
    this.group.add(this.bubble);
    this.bubbleTime = 4;
  }
  attack() { this.attackT = 0.28; }
  flash() { this.flashT = 0.15; }
  update(dt, pos, vel, onGround, faceTarget) {
    this.group.position.copy(pos);
    const speed = Math.hypot(vel.x, vel.z);
    let target = null;
    if (faceTarget) target = Math.atan2(faceTarget.x - pos.x, faceTarget.z - pos.z);
    else if (speed > 0.3) target = Math.atan2(vel.x, vel.z);
    if (target !== null) {
      const d = Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing));
      this.facing += d * Math.min(1, dt * 14);
    }
    this.body.rotation.y = this.facing;
    if (!onGround) {
      this.legL.rotation.x = 0.4; this.legR.rotation.x = -0.4;
      this.armL.rotation.x = Math.PI * 0.9; this.armR.rotation.x = Math.PI * 0.9;
    } else if (speed > 0.3) {
      this.phase += dt * speed * 1.7;
      const s = Math.sin(this.phase) * 0.9;
      this.legL.rotation.x = s; this.legR.rotation.x = -s;
      this.armL.rotation.x = -s; this.armR.rotation.x = s;
    } else {
      for (const p of [this.legL, this.legR, this.armL, this.armR]) p.rotation.x *= Math.max(0, 1 - dt * 10);
    }
    if (this.attackT > 0) {
      this.attackT -= dt;
      const k = 1 - Math.max(0, this.attackT) / 0.28;
      this.armR.rotation.x = -2.6 + k * 3.2;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      for (const m of this.mats) m.emissive.setHex(on ? 0xaa0000 : 0x000000);
    }
    if (this.bubble) {
      this.bubbleTime -= dt;
      if (this.bubbleTime <= 0) { this.group.remove(this.bubble); this.bubble.material.map.dispose(); this.bubble = null; }
    }
  }
}

// ---------- Physics ----------
const GRAVITY = 32;
class Body {
  constructor(x, y, z, w = 0.32, h = 1.85) {
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.wasGround = false;
    this.inWater = false;
    this.w = w; this.h = h;
  }
  collides() {
    const p = this.pos, w = this.w;
    const x0 = Math.floor(p.x - w), x1 = Math.floor(p.x + w - 1e-6);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + this.h - 1e-6);
    const z0 = Math.floor(p.z - w), z1 = Math.floor(p.z + w - 1e-6);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (world.has(key(x, y, z))) return true;
    }
    return false;
  }
  moveAxis(axis, d) {
    if (d === 0) return false;
    const p = this.pos;
    p[axis] += d;
    if (!this.collides()) return false;
    if (axis !== 'y' && this.wasGround) {
      // Step up onto a single block, so hills and stairs can be walked
      const y = p.y;
      p.y = Math.floor(y + 0.01) + 1;
      if (!this.collides()) return false;
      p.y = y;
    }
    if (axis === 'y') {
      if (d < 0) p.y = Math.floor(p.y) + 1;
      else p.y = Math.floor(p.y + this.h) - this.h - 1e-4;
    } else if (d > 0) p[axis] = Math.floor(p[axis] + this.w) - this.w - 1e-4;
    else p[axis] = Math.floor(p[axis] - this.w) + 1 + this.w + 1e-4;
    if (this.collides()) p[axis] -= d;
    return true;
  }
  step(dt) {
    this.inWater = this.pos.y < WATER_Y && (inLake(this.pos.x, this.pos.z) || isLandWater(this.pos.x, this.pos.z));
    if (this.inWater) this.vel.y = Math.max(this.vel.y - GRAVITY * 0.25 * dt, -2.5);
    else this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -60);
    const maxD = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt;
    const n = Math.max(1, Math.ceil(maxD / 0.3));
    const sdt = dt / n;
    this.wasGround = this.onGround;
    this.onGround = false;
    let blocked = false;
    for (let i = 0; i < n; i++) {
      if (this.moveAxis('x', this.vel.x * sdt)) blocked = true;
      if (this.moveAxis('z', this.vel.z * sdt)) blocked = true;
      if (this.moveAxis('y', this.vel.y * sdt)) {
        if (this.vel.y < 0) { this.onGround = true; this.wasGround = true; }
        this.vel.y = 0;
      }
    }
    return blocked;
  }
  standingOn() {
    const p = this.pos, w = this.w - 0.02;
    const y = Math.floor(p.y - 0.05);
    for (const [dx, dz] of [[0, 0], [-w, -w], [w, -w], [-w, w], [w, w]]) {
      const t = world.get(key(Math.floor(p.x + dx), y, Math.floor(p.z + dz)));
      if (t !== undefined) return t;
    }
    return undefined;
  }
}

// ---------- Player ----------
const MAX_HP = 100;
const player = {
  body: new Body(...gen.spawn),
  avatar: null,
  jumpHeld: false,
  hp: MAX_HP,
  hurtT: 0,
  attackCd: 0,
  boostT: 0,
  padCd: 0,
  invuln: 0,
};
const checkpointById = new Map(gen.checkpoints.map((c) => [c.id, c]));
function respawn() {
  const cp = save.cp && checkpointById.get(save.cp);
  const s = cp ? cp.spawn : gen.spawn;
  player.body.pos.set(s[0], s[1], s[2]);
  player.body.vel.set(0, 0, 0);
  player.hp = MAX_HP;
  player.invuln = 2;
  updateHpUI();
}
function teleport(p) {
  player.body.pos.set(p[0], p[1], p[2]);
  player.body.vel.set(0, 0, 0);
  player.invuln = 1.5;
}

// ---------- Bots ----------
const BOT_DEFS = [
  ['Aziz', 0x43a047], ['Malika', 0xf06292], ['Bekzod', 0xfb8c00], ['Dilnoza', 0x8e24aa],
  ['Sardor', 0x00897b], ['Nilufar', 0xfdd835], ['Jasur', 0x5d4037], ['Madina', 0x3949ab],
];
const BOT_LINES = ['Salom!', 'Qalaysan?', "Obbyni o'tdingmi?", "Zo'r o'yin!", 'Keling, uy quramiz!', "Roblon yig'yapman",
  "Registonga bordingmi?", "Labirintda qo'riqchi bor!", "O'rmonda shilimshiqlar ko'p", "Qiyin yo'l juda qiyin!"];
const bots = BOT_DEFS.map(([name, color], i) => {
  const a = (i / BOT_DEFS.length) * Math.PI * 2;
  const b = {
    name, coins: Math.floor(Math.random() * 60),
    body: new Body(Math.cos(a) * 6, 1, Math.sin(a) * 6),
    avatar: new Avatar(name, color),
    target: new THREE.Vector3(), timer: 0, idle: 0, chat: 4 + Math.random() * 14,
  };
  return b;
});
function pickBotTarget(b) {
  const [x, z] = gen.waypoints[Math.floor(Math.random() * gen.waypoints.length)];
  b.target.set(x + (Math.random() - 0.5) * 6, 0, z + (Math.random() - 0.5) * 6);
  b.timer = 25 + Math.random() * 15;
}
bots.forEach(pickBotTarget);
function updateBot(b, dt) {
  const body = b.body;
  if (b.idle > 0) {
    b.idle -= dt;
    body.vel.x *= 0.8; body.vel.z *= 0.8;
  } else {
    const dx = b.target.x - body.pos.x, dz = b.target.z - body.pos.z;
    const d = Math.hypot(dx, dz);
    b.timer -= dt;
    if (d < 1.5 || b.timer < 0) { pickBotTarget(b); b.idle = Math.random() * 4; }
    const sp = body.inWater ? 3 : 5;
    body.vel.x = (dx / (d || 1)) * sp; body.vel.z = (dz / (d || 1)) * sp;
  }
  const blocked = body.step(dt);
  if (blocked && (body.onGround || body.inWater)) body.vel.y = body.inWater ? 6 : 10;
  if (body.pos.y < -20) { body.pos.set(...gen.spawn); body.vel.set(0, 0, 0); }
  b.chat -= dt;
  if (b.chat < 0) { b.avatar.say(BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]); b.chat = 12 + Math.random() * 25; }
  if (Math.random() < dt * 0.05) b.coins++;
  b.avatar.update(dt, body.pos, body.vel, body.onGround);
}

// ---------- Enemies ----------
// Difficulty: how strong enemies are next to the hero. 'tinch' = enemies never attack.
const DIFF = {
  tinch: { name: 'Tinch', hp: 0.6, dmg: 0, reward: 0.5, regen: 10, aggro: 1, speed: 1 },
  oson: { name: 'Oson', hp: 0.6, dmg: 0.45, reward: 1, regen: 8, aggro: 0.8, speed: 0.85 },
  orta: { name: "O'rta", hp: 0.85, dmg: 0.75, reward: 1, regen: 6, aggro: 1, speed: 1 },
  qiyin: { name: 'Qiyin', hp: 1.3, dmg: 1.4, reward: 1.5, regen: 3, aggro: 1.3, speed: 1.1 },
};
const diff = () => DIFF[save.diff] || DIFF.orta;
const ENEMY = {
  slime: { name: 'Shilimshiq', hp: 60, dmg: 10, speed: 6, aggro: 14, reward: 3, w: 0.5, h: 1.0, respawn: 25 },
  knight: { name: 'Qora ritsar', hp: 140, dmg: 16, speed: 5.4, aggro: 18, reward: 10, w: 0.32, h: 1.85, respawn: 35 },
  boss: { name: "Labirint qo'riqchisi", hp: 450, dmg: 25, speed: 4.6, aggro: 12, reward: 60, w: 0.5, h: 2.9, respawn: 120 },
};
function makeHpSprite() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 10;
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.2, 0.19, 1);
  s.userData = { c, tex };
  s.visible = false;
  return s;
}
function drawHp(s, ratio) {
  const { c, tex } = s.userData;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 64, 10);
  g.fillStyle = ratio > 0.5 ? '#4cd964' : ratio > 0.25 ? '#ffcc00' : '#ff3b30';
  g.fillRect(1, 1, Math.max(0, 62 * ratio), 8);
  tex.needsUpdate = true;
  s.visible = true;
}

class Enemy {
  constructor(type, home) {
    this.type = type;
    this.cfg = ENEMY[type];
    this.home = new THREE.Vector3(...home);
    this.body = new Body(home[0], home[1], home[2], this.cfg.w, this.cfg.h);
    this.hp = this.maxHp;
    this.dead = false;
    this.respawnT = 0;
    this.hitCd = 0;
    this.hopT = Math.random();
    this.wander = new THREE.Vector3().copy(this.home);
    this.wanderT = 0;
    if (type === 'slime') {
      this.group = new THREE.Group();
      this.mat = new THREE.MeshLambertMaterial({ color: 0x5ee05e, transparent: true, opacity: 0.85 });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.1), this.mat);
      cube.position.y = 0.5; cube.castShadow = true;
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), new THREE.MeshLambertMaterial({ color: 0x2e8b2e }));
      core.position.y = 0.45;
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.05), eyeMat); e1.position.set(-0.22, 0.62, 0.56);
      const e2 = e1.clone(); e2.position.x = 0.22;
      this.inner = new THREE.Group();
      this.inner.add(cube, core, e1, e2);
      this.group.add(this.inner);
      this.label = makeLabel(this.cfg.name, { color: '#ff8a80', scale: 0.009 });
      this.label.position.y = 1.55;
      this.group.add(this.label);
      scene.add(this.group);
      this.facing = 0;
    } else {
      const boss = type === 'boss';
      this.avatar = new Avatar(this.cfg.name, boss ? 0x4a148c : 0x2b2b2b, {
        evil: true, sword: true, helmet: true, scale: boss ? 1.6 : 1, labelColor: '#ff8a80',
      });
      this.group = this.avatar.group;
    }
    this.hpSprite = makeHpSprite();
    this.hpSprite.position.y = this.cfg.h + 0.75;
    this.group.add(this.hpSprite);
  }
  get pos() { return this.body.pos; }
  get maxHp() { return Math.round(this.cfg.hp * diff().hp); }
  damage(amount, from) {
    if (this.dead) return;
    this.hp -= amount;
    drawHp(this.hpSprite, Math.max(0, this.hp / this.maxHp));
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    const kb = this.type === 'boss' ? 4 : 9;
    this.body.vel.set((dx / d) * kb, 6, (dz / d) * kb);
    this.stunT = 0.35;
    if (this.avatar) this.avatar.flash();
    else { this.mat.color.setHex(0xff5555); this.flashT = 0.15; }
    burst(new THREE.Vector3(this.pos.x, this.pos.y + this.cfg.h * 0.6, this.pos.z), 0xff4444, 6, 4);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true;
    this.respawnT = this.cfg.respawn;
    this.group.visible = false;
    burst(new THREE.Vector3(this.pos.x, this.pos.y + 0.8, this.pos.z), this.type === 'slime' ? 0x5ee05e : 0x333333, 22, 7);
    burst(new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z), 0xffcc33, 10, 5);
    sfx('kill');
    const reward = Math.max(1, Math.round(this.cfg.reward * diff().reward));
    save.coins += reward;
    save.kills += 1;
    persist(); updateCoinsUI();
    toast(`${this.cfg.name} yengildi! +${reward} Roblon`, 1800);
  }
  revive() {
    this.dead = false;
    this.hp = this.maxHp;
    this.body.pos.copy(this.home);
    this.body.vel.set(0, 0, 0);
    this.group.visible = true;
    this.hpSprite.visible = false;
  }
  update(dt, playerSafe) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.revive();
      return;
    }
    const b = this.body, p = player.body.pos;
    this.hitCd -= dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.mat.color.setHex(0x5ee05e); }
    const toP = new THREE.Vector3(p.x - b.pos.x, 0, p.z - b.pos.z);
    const dist = toP.length();
    const fromHome = Math.hypot(b.pos.x - this.home.x, b.pos.z - this.home.z);
    const d = diff();
    const chasing = !playerSafe && d.dmg > 0 && player.hp > 0 && dist < this.cfg.aggro * d.aggro && fromHome < 30;
    let dir;
    if (chasing) dir = toP.normalize();
    else {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || fromHome > 30) {
        this.wander.set(this.home.x + (Math.random() - 0.5) * 14, 0, this.home.z + (Math.random() - 0.5) * 14);
        if (fromHome > 30) this.wander.copy(this.home);
        this.wanderT = 3 + Math.random() * 4;
      }
      dir = new THREE.Vector3(this.wander.x - b.pos.x, 0, this.wander.z - b.pos.z);
      const wl = dir.length();
      dir.multiplyScalar(wl > 1 ? 1 / wl : 0);
      if (!chasing && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 8);
    }
    if (this.stunT > 0) {
      this.stunT -= dt;
    } else if (this.type === 'slime') {
      if (b.onGround) {
        b.vel.x *= 0.8; b.vel.z *= 0.8;
        this.hopT -= dt;
        if (this.hopT <= 0) {
          const sp = chasing ? this.cfg.speed * d.speed : 2.5;
          b.vel.set(dir.x * sp, chasing ? 8.5 : 6, dir.z * sp);
          this.hopT = chasing ? 0.55 : 1.2 + Math.random();
        }
      }
    } else {
      const sp = chasing ? this.cfg.speed * d.speed : 2.2;
      b.vel.x = dir.x * sp; b.vel.z = dir.z * sp;
    }
    const blocked = b.step(dt);
    if (blocked && (b.onGround || b.inWater) && this.type !== 'slime') b.vel.y = 10;
    if (b.pos.y < -20) this.revive();

    // Contact attack
    const reach = this.type === 'boss' ? 2.4 : 1.5;
    if (chasing && dist < reach && Math.abs(p.y - b.pos.y) < 2 && this.hitCd <= 0) {
      this.hitCd = this.type === 'slime' ? 0.9 : 1.1;
      if (this.avatar) this.avatar.attack();
      hurtPlayer(Math.round(this.cfg.dmg * d.dmg), b.pos);
    }
    if (this.avatar) this.avatar.update(dt, b.pos, b.vel, b.onGround, chasing ? p : null);
    else {
      this.group.position.copy(b.pos);
      if (Math.hypot(dir.x, dir.z) > 0.1) this.facing = Math.atan2(dir.x, dir.z);
      this.inner.rotation.y = this.facing;
      const sq = b.onGround ? 1 : 1 + Math.min(0.3, Math.abs(b.vel.y) * 0.03);
      this.inner.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
  }
}
const enemies = gen.enemyHomes.map((e) => new Enemy(e.type, e.pos));

function hurtPlayer(dmg, from) {
  if (player.invuln > 0 || player.hp <= 0) return;
  player.hp -= dmg;
  player.hurtT = 4;
  player.avatar.flash();
  const b = player.body;
  const dx = b.pos.x - from.x, dz = b.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
  b.vel.set((dx / d) * 9, 6, (dz / d) * 9);
  sfx('hurt');
  flashDamage();
  if (player.hp <= 0) {
    player.hp = 0;
    sfx('die');
    toast("Yengildingiz! Qayta tug'ilasiz", 2000);
    burst(new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z), SHIRT_COLORS[save.shirt], 20, 7);
    setTimeout(respawn, 900);
  }
  updateHpUI();
}

function playerAttack() {
  if (!running || paused || player.attackCd > 0 || player.hp <= 0) return;
  player.attackCd = 0.42;
  player.avatar.attack();
  attackSeq = (attackSeq + 1) % 100;
  sfx('swing');
  const p = player.body.pos;
  let hit = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    const reach = 2.6 + (e.type === 'boss' ? 0.8 : 0);
    if (d < reach && e.pos.y - p.y < 2.5 && p.y - e.pos.y < 2.5) {
      e.damage(34, p);
      hit = true;
    }
  }
  if (hit) sfx('hit');
}

// ---------- Coins ----------
const coinGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.1, 20);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshLambertMaterial({ color: 0xffcc33, emissive: 0x6b4c00 });
const bigCoinMat = new THREE.MeshLambertMaterial({ color: 0xffb300, emissive: 0x8a5a00 });
function makeCoin({ pos: [x, y, z], value }) {
  const m = new THREE.Mesh(coinGeo, value > 1 ? bigCoinMat : coinMat);
  m.position.set(x, y, z);
  if (value > 1) m.scale.setScalar(1.7);
  m.castShadow = true;
  scene.add(m);
  return { mesh: m, value, respawnIn: 0 };
}
const coins = gen.coins.map(makeCoin);

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const toastEl = $('toast');
let toastTimer = 0;
function toast(msg, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}
function updateCoinsUI() { $('coinCount').textContent = save.coins; if (online) online.coinsChanged(); }
function updateHpUI() {
  const r = Math.max(0, player.hp) / MAX_HP;
  $('hpFill').style.width = (r * 100).toFixed(1) + '%';
  $('hpFill').style.background = r > 0.5 ? 'var(--hp-good)' : r > 0.25 ? 'var(--hp-warn)' : 'var(--hp-bad)';
  $('hpText2').textContent = Math.ceil(Math.max(0, player.hp));
}
let damageTimer = 0;
function flashDamage() {
  const v = $('damage');
  v.classList.add('on');
  clearTimeout(damageTimer);
  damageTimer = setTimeout(() => v.classList.remove('on'), 250);
}
let currentZone = null;
let currentBiome = null;
function updateStageUI() {
  const cp = save.cp && checkpointById.get(save.cp);
  const doneCount = Object.keys(save.done).length;
  let text = currentZone ? currentZone.name : (biomeAt(player.body.pos.x, player.body.pos.z) || 'Yovvoyi tabiat');
  if (cp && inObby(player.body.pos)) text = `${cp.label}: ${cp.stage}-nazorat`;
  $('stage').textContent = text + (doneCount ? ` · Obby ${doneCount}/3 ★` : '');
}
let playersTimer = 0;
function updatePlayersUI() {
  const others = online
    ? online.room.players.filter((p) => p.id !== online.room.id).map((p) => ({ name: p.name || p.id, coins: p.coins || 0 }))
    : bots.map((b) => ({ name: b.name, coins: b.coins }));
  const rows = [{ name: save.name, coins: save.coins, me: true }, ...others]
    .sort((a, b) => b.coins - a.coins).slice(0, 6);
  const head = online ? `Onlayn: ${online.room.players.length || 1} kishi` : 'Reyting';
  $('players').innerHTML = `<div class="head">${head}</div>` + rows.map((r) =>
    `<div class="row${r.me ? ' me' : ''}"><span>${escapeHtml(r.name)}</span><span>${r.coins}</span></div>`).join('');
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Minimap
const MM = $('minimap');
const mmg = MM.getContext('2d');
const mmBase = document.createElement('canvas');
{
  const N = MAP * 2;
  mmBase.width = mmBase.height = N;
  const g = mmBase.getContext('2d');
  const img = g.createImageData(N, N);
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    const c = gen.topColors[x * N + z];
    const i = (z * N + x) * 4;
    img.data[i] = (c >> 16) & 255; img.data[i + 1] = (c >> 8) & 255; img.data[i + 2] = c & 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
let mmTimer = 0;
// Inside the hand-made map the minimap shows all of it; out in the endless land it follows the player
const LOCAL_W = 96;
const mmLocal = document.createElement('canvas');
mmLocal.width = mmLocal.height = LOCAL_W;
const mmLocalImg = mmLocal.getContext('2d').createImageData(LOCAL_W, LOCAL_W);
let mmLocalAt = null;
function topColorAt(x, z) {
  if (x >= -MAP && x < MAP && z >= -MAP && z < MAP) return gen.topColors[(x + MAP) * MAP * 2 + (z + MAP)];
  const c = landColors.get(colKey(x, z));
  return c === undefined ? 0x1b2238 : c;
}
function drawMinimap() {
  const S = MM.width;
  const pl = player.body.pos;
  const inside = Math.abs(pl.x) < MAP && Math.abs(pl.z) < MAP;
  const W = inside ? MAP * 2 : LOCAL_W;
  const ox = inside ? -MAP : Math.floor(pl.x) - LOCAL_W / 2, oz = inside ? -MAP : Math.floor(pl.z) - LOCAL_W / 2;
  const k = S / W;
  mmg.imageSmoothingEnabled = false;
  if (inside) mmg.drawImage(mmBase, 0, 0, S, S);
  else {
    if (!mmLocalAt || Math.abs(mmLocalAt[0] - ox) + Math.abs(mmLocalAt[1] - oz) >= 2 || mmLocalAt[2] !== landColors.size) {
      const d = mmLocalImg.data;
      for (let x = 0; x < W; x++) for (let z = 0; z < W; z++) {
        const c = topColorAt(ox + x, oz + z);
        const i = (z * W + x) * 4;
        d[i] = (c >> 16) & 255; d[i + 1] = (c >> 8) & 255; d[i + 2] = c & 255; d[i + 3] = 255;
      }
      mmLocal.getContext('2d').putImageData(mmLocalImg, 0, 0);
      mmLocalAt = [ox, oz, landColors.size];
    }
    mmg.drawImage(mmLocal, (mmLocalAt[0] - ox) * k, (mmLocalAt[1] - oz) * k, S, S);
  }
  const px = (x) => (x - ox) * k, pz = (z) => (z - oz) * k;
  mmg.fillStyle = '#ff3b30';
  for (const e of enemies) if (!e.dead) { mmg.fillRect(px(e.pos.x) - 2, pz(e.pos.z) - 2, 4, 4); }
  mmg.fillStyle = '#ffffff';
  if (!online) for (const b of bots) { mmg.beginPath(); mmg.arc(px(b.body.pos.x), pz(b.body.pos.z), 2.2, 0, Math.PI * 2); mmg.fill(); }
  mmg.fillStyle = '#5ce1ff';
  for (const r of remotes.values()) { mmg.beginPath(); mmg.arc(px(r.pos.x), pz(r.pos.z), 3, 0, Math.PI * 2); mmg.fill(); }
  const p = player.body.pos;
  const a = player.avatar ? player.avatar.facing : 0;
  mmg.save();
  mmg.translate(Math.min(S - 4, Math.max(4, px(p.x))), Math.min(S - 4, Math.max(4, pz(p.z))));
  mmg.rotate(-a + Math.PI);
  mmg.fillStyle = '#ffe680'; mmg.strokeStyle = '#000'; mmg.lineWidth = 1.5;
  mmg.beginPath(); mmg.moveTo(0, -7); mmg.lineTo(5, 5); mmg.lineTo(0, 2); mmg.lineTo(-5, 5); mmg.closePath();
  mmg.fill(); mmg.stroke();
  mmg.restore();
}

// Start screen
const shirtBox = $('shirtColors');
SHIRT_COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.style.background = '#' + c.toString(16).padStart(6, '0');
  b.setAttribute('aria-label', 'Rang ' + (i + 1));
  if (i === save.shirt) b.classList.add('sel');
  b.onclick = () => {
    save.shirt = i;
    [...shirtBox.children].forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  };
  shirtBox.appendChild(b);
});
$('nameInput').value = save.name;
function renderDiffs() {
  for (const b of $('diffs').children) b.classList.toggle('sel', b.dataset.d === save.diff);
}
for (const b of $('diffs').children) b.onclick = () => { save.diff = b.dataset.d; persist(); renderDiffs(); };
renderDiffs();

let running = false;
let paused = false;
function startGame() {
  initAudio();
  player.avatar = new Avatar(save.name, SHIRT_COLORS[save.shirt], { sword: true, labelColor: '#ffe680' });
  respawn();
  $('startScreen').classList.remove('on');
  hud.classList.add('on');
  running = true;
  updateCoinsUI(); updateStageUI(); updatePlayersUI(); updateHpUI();
  toast(`Xush kelibsiz, ${save.name}!`, 2500);
  if (!online) setTimeout(() => bots[0].avatar.say(`Salom, ${save.name}!`), 1500);
}
$('playBtn').onclick = () => {
  if (startMode === 'online') { startOnline(); return; }
  const n = $('nameInput').value.trim().slice(0, 14);
  save.name = n || 'Mehmon' + Math.floor(Math.random() * 900 + 100);
  persist();
  startGame();
};

// ---------- Online mode ----------
let startMode = 'offline';
let online = null; // { room, coinsChanged() } while playing online
const remotes = new Map();
const onlineEdits = new Map(); // block key -> type (or null for removed) changed during this online session
function setStartMode(m) {
  startMode = m;
  $('tabOff').classList.toggle('sel', m === 'offline');
  $('tabOn').classList.toggle('sel', m === 'online');
  $('offPane').hidden = m !== 'offline';
  $('onPane').hidden = m !== 'online';
  $('playBtn').textContent = m === 'online' ? 'ONLAYN O\'YNASH' : "O'YNASH";
  if (m === 'online') refreshAccount();
}
$('tabOff').onclick = () => setStartMode('offline');
$('tabOn').onclick = () => setStartMode('online');
let accountInfo = null;
function showAuth(info, err) {
  accountInfo = info;
  $('authForm').hidden = !!info;
  $('authOk').hidden = !info;
  $('authErr').textContent = err || '';
  if (info) { $('accName').textContent = info.username; $('accCoins').textContent = info.coins; }
}
async function refreshAccount() {
  if (!account.session) { showAuth(null); return; }
  if (accountInfo) return;
  $('authErr').textContent = 'Ulanmoqda...';
  const r = await account.me();
  showAuth(r.error ? null : r, r.error && account.session ? r.error : '');
}
async function doAuth(kind) {
  const u = $('userInput').value.trim(), pw = $('passInput').value;
  if (!u || !pw) { $('authErr').textContent = 'Login va parolni yozing'; return; }
  $('loginBtn').disabled = $('registerBtn').disabled = true;
  $('authErr').textContent = 'Kuting...';
  const r = kind === 'register' ? await account.register(u, pw, save.shirt) : await account.login(u, pw);
  $('loginBtn').disabled = $('registerBtn').disabled = false;
  if (r.error) { $('authErr').textContent = r.error; return; }
  $('passInput').value = '';
  showAuth(r);
  if (kind === 'register') toast("Ro'yxatdan o'tdingiz!");
}
$('loginBtn').onclick = () => doAuth('login');
$('registerBtn').onclick = () => doAuth('register');
$('passInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });
$('logoutBtn').onclick = () => { account.logout(); showAuth(null); };

function revertLocalEdits() {
  // Online everyone starts from the same map; the phone's own builds come back in offline mode
  const touched = new Set([...Object.keys(save.added).map(Number), ...save.removed]);
  for (const k of touched) {
    const [x, y, z] = parseKey(k);
    setBlockAt(x, y, z, baseWorld.has(k) ? baseWorld.get(k) : null);
  }
  flushChunks();
}
function applyEdit(k, t) {
  const [x, y, z] = parseKey(k);
  if (t === null) { if (!world.has(k) || gen.protectedKeys.has(k)) return; } else if (!BLOCKS[t] || world.get(k) === t) return;
  setBlockAt(x, y, z, t);
  onlineEdits.set(k, t);
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.avatar.group);
  remotes.delete(id);
}
function startOnline() {
  if (!accountInfo) { $('authErr').textContent = 'Avval kiring yoki ro\'yxatdan o\'ting'; return; }
  const room = ($('roomInput').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'umumiy').slice(0, 12);
  offlineCoins = save.coins;
  save.name = accountInfo.username;
  save.coins = accountInfo.coins;
  for (const b of bots) b.avatar.group.visible = false;
  revertLocalEdits();
  let saveTimer2 = 0;
  online = {
    roomName: room,
    room: joinRoom(room, { username: accountInfo.username, shirt: save.shirt, coins: save.coins }, {
      onState(id, st) {
        let r = remotes.get(id);
        if (!r || r.shirt !== st.c) {
          if (r) removeRemote(id);
          r = { avatar: new Avatar(id, SHIRT_COLORS[st.c] ?? SHIRT_COLORS[0], { sword: true, labelColor: '#9fe8ff' }),
            pos: new THREE.Vector3(st.x, st.y, st.z), target: new THREE.Vector3(), vel: new THREE.Vector3(),
            shirt: st.c, atk: st.a, ground: true, face: 0, seen: 0 };
          remotes.set(id, r);
        }
        r.target.set(st.x, st.y, st.z); r.vel.set(st.vx, 0, st.vz);
        r.ground = !!st.g; r.face = st.f; r.seen = performance.now();
        if (st.a !== r.atk) { r.atk = st.a; r.avatar.attack(); }
      },
      onLeave: removeRemote,
      onPlayers(list) {
        updatePlayersUI();
        const ids = new Set(list.map((p) => p.id));
        for (const id of [...remotes.keys()]) if (!ids.has(id)) removeRemote(id);
      },
      onNewcomer(id) { if (onlineEdits.size) online.room.sendEdits(id, [...onlineEdits]); },
      onEdits(list) { for (const [k, t] of list) applyEdit(Number(k), t); flushChunks(); },
      onBlock(b) { if (b) { applyEdit(Number(b.k), b.t); flushChunks(); } },
      onChat(id, text) {
        const r = remotes.get(id);
        if (r) r.avatar.say(text);
        toast(`${id}: ${text}`, 2500);
      },
      onVoice(id, mime, data) {
        try {
          const bin = atob(data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          const audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          audio.play().catch(() => {});
          const r = remotes.get(id);
          if (r) r.avatar.say('🔊 ...');
          toast(`🔊 ${id}`, 2000);
        } catch (e) { /* bad clip */ }
      },
      onStatus(ok) {
        const el = $('netBadge');
        el.textContent = ok ? `· onlayn, xona: ${room}` : '· aloqa uzildi';
        el.className = ok ? 'ok' : 'bad';
        if (!ok) toast("Server bilan aloqa uzildi, qayta ulanmoqda...");
      },
    }),
    coinsChanged() {
      clearTimeout(saveTimer2);
      saveTimer2 = setTimeout(() => {
        account.save(save.coins, save.shirt);
        online.room.updateMeta({ shirt: save.shirt, coins: save.coins });
      }, 1500);
    },
  };
  $('voiceBtn').hidden = !(navigator.mediaDevices && window.MediaRecorder);
  $('leaveOnlineBtn').hidden = false;
  $('resetBuildBtn').hidden = true;
  $('menuHelp').textContent = 'Onlayn: Roblon akkauntingizda saqlanadi. Qurganlaringizni xonadagilar ko\'radi.';
  startGame();
  toast(`Xona: ${room}`, 2500);
}
let stateTimer = 0, attackSeq = 0;
function updateOnline(dt) {
  if (!online) return;
  const now = performance.now();
  for (const [id, r] of remotes) {
    if (now - r.seen > 15000) { removeRemote(id); continue; }
    if (r.pos.distanceToSquared(r.target) > 400) r.pos.copy(r.target);
    else r.pos.lerp(r.target, Math.min(1, dt * 12));
    const ft = r.pos.clone(); ft.x += Math.sin(r.face); ft.z += Math.cos(r.face);
    r.avatar.update(dt, r.pos, r.vel, r.ground, ft);
  }
  stateTimer -= dt;
  if (stateTimer < 0 && player.avatar) {
    stateTimer = 0.1;
    const b = player.body;
    const q = (v) => Math.round(v * 100) / 100;
    online.room.sendState({ x: q(b.pos.x), y: q(b.pos.y), z: q(b.pos.z), vx: q(b.vel.x), vz: q(b.vel.z),
      g: b.onGround ? 1 : 0, f: q(player.avatar.facing), a: attackSeq, c: save.shirt });
  }
}
$('leaveOnlineBtn').onclick = () => {
  if (online) { account.save(save.coins, save.shirt); online.room.leave(); }
  location.reload();
};
function openChat() {
  $('chatBar').classList.add('on');
  $('chatInput').focus();
}
function sendChat() {
  const text = $('chatInput').value.trim().slice(0, 60);
  $('chatBar').classList.remove('on');
  $('chatInput').value = '';
  $('chatInput').blur();
  if (!text || !online) return;
  online.room.sendChat(text);
  if (player.avatar) player.avatar.say(text);
}
// Voice messages: hold the button, talk, release to send (max 10 s)
const VOICE_MAX = 10;
let rec = null;
function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}
async function startVoice() {
  if (rec || !online) return;
  rec = { chunks: [], cancelled: false, t0: performance.now() };
  const mine = rec;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    rec = null;
    toast('Mikrofonga ruxsat berilmadi', 2500);
    return;
  }
  if (mine.cancelled) { stream.getTracks().forEach((t) => t.stop()); rec = null; return; }
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
  mine.mr = mr; mine.stream = stream;
  mr.ondataavailable = (e) => { if (e.data && e.data.size) mine.chunks.push(e.data); };
  mr.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const dur = (performance.now() - mine.t0) / 1000;
    if (mine.chunks.length && dur > 0.4) sendVoiceClip(new Blob(mine.chunks, { type: mr.mimeType || mime || 'audio/webm' }));
  };
  mr.start();
  $('voiceBtn').classList.add('rec');
  $('recBadge').classList.add('on');
  mine.timer = setInterval(() => {
    const sec = (performance.now() - mine.t0) / 1000;
    $('recTime').textContent = Math.floor(sec);
    if (sec >= VOICE_MAX) stopVoice();
  }, 200);
}
function stopVoice() {
  if (!rec) return;
  const r = rec;
  rec = null;
  r.cancelled = true;
  clearInterval(r.timer);
  $('voiceBtn').classList.remove('rec');
  $('recBadge').classList.remove('on');
  if (r.mr && r.mr.state !== 'inactive') r.mr.stop();
}
function sendVoiceClip(blob) {
  if (!online) return;
  if (blob.size > 200000) { toast('Xabar juda uzun', 2000); return; }
  const fr = new FileReader();
  fr.onload = () => {
    const data = String(fr.result).split(',')[1] || '';
    online.room.sendVoice(blob.type.split(';')[0] ? blob.type : 'audio/webm', data);
    if (player.avatar) player.avatar.say('🔊 ...');
    toast('Ovozli xabar yuborildi', 1500);
  };
  fr.readAsDataURL(blob);
}
holdButton($('voiceBtn'), startVoice, stopVoice);
$('chatBtn').onclick = () => ($('chatBar').classList.contains('on') ? sendChat() : openChat());
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); if (e.key === 'Escape') sendChat(); });
if (account.session) $('userInput').value = account.session.username;

// Menu
function openMenu() { paused = true; $('menuScreen').classList.add('on'); renderSettings(); }
function closeMenu() { paused = false; $('menuScreen').classList.remove('on'); last = performance.now(); }
$('menuBtn').onclick = openMenu;
$('resumeBtn').onclick = closeMenu;
$('respawnBtn').onclick = () => respawn();
const travel = $('travel');
for (const z of ZONES) {
  const b = document.createElement('button');
  b.className = 'travelBtn';
  b.textContent = z.name;
  b.onclick = () => { teleport(z.travel); closeMenu(); toast(z.name); };
  travel.appendChild(b);
}
function renderSettings() {
  $('soundBtn').textContent = 'Ovoz: ' + (save.sound ? 'yoqilgan' : "o'chirilgan");
  $('gfxBtn').textContent = 'Grafika: ' + (save.gfx === 'high' ? 'yuqori' : 'past (tezroq)');
  $('diffBtn').textContent = 'Qiyinlik: ' + diff().name;
}
$('soundBtn').onclick = () => { save.sound = !save.sound; initAudio(); persist(); renderSettings(); };
const DIFF_ORDER = ['tinch', 'oson', 'orta', 'qiyin'];
$('diffBtn').onclick = () => {
  save.diff = DIFF_ORDER[(DIFF_ORDER.indexOf(save.diff) + 1) % DIFF_ORDER.length];
  persist(); renderSettings(); renderDiffs();
};
$('gfxBtn').onclick = () => { save.gfx = save.gfx === 'high' ? 'low' : 'high'; persist(); renderSettings(); applyGraphics(); };
$('resetBuildBtn').onclick = () => {
  const touched = new Set([...Object.keys(save.added).map(Number), ...save.removed]);
  for (const k of touched) {
    const [x, y, z] = parseKey(k);
    setBlockAt(x, y, z, baseWorld.has(k) ? baseWorld.get(k) : null);
  }
  save.added = {}; save.removed = [];
  persist(); flushChunks();
  toast('Qurilganlar tozalandi');
  closeMenu();
};
$('resetAllBtn').onclick = () => {
  try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(OLD_SAVE_KEY); } catch (e) { /* ignore */ }
  location.reload();
};

// ---------- Build mode ----------
let buildMode = false;
let deleteMode = false;
let buildType = BUILD_PALETTE[0];
const buildBar = $('buildBar');
function renderBuildBar() {
  buildBar.innerHTML = '';
  const place = document.createElement('button');
  place.className = 'modeBtn' + (!deleteMode ? ' sel' : '');
  place.textContent = "Qo'yish";
  place.onclick = () => { deleteMode = false; renderBuildBar(); };
  const del = document.createElement('button');
  del.className = 'modeBtn del' + (deleteMode ? ' sel' : '');
  del.textContent = "O'chirish";
  del.onclick = () => { deleteMode = true; renderBuildBar(); };
  buildBar.append(place, del);
  for (const t of BUILD_PALETTE) {
    const s = document.createElement('button');
    s.className = 'swatch' + (t === buildType && !deleteMode ? ' sel' : '');
    s.style.background = '#' + BLOCKS[t].color.toString(16).padStart(6, '0');
    s.title = BLOCKS[t].name;
    s.onclick = () => { buildType = t; deleteMode = false; renderBuildBar(); };
    buildBar.appendChild(s);
  }
}
function setBuildMode(on) {
  buildMode = on;
  $('buildBtn').classList.toggle('active', on);
  buildBar.classList.toggle('on', on);
  if (on) { renderBuildBar(); toast('Qurish: ekranga bosing'); }
}
$('buildBtn').addEventListener('click', () => setBuildMode(!buildMode));

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function bodyOverlapsCell(b, x, y, z) {
  const p = b.pos;
  return p.x + b.w > x && p.x - b.w < x + 1 && p.y + b.h > y && p.y < y + 1 && p.z + b.w > z && p.z - b.w < z + 1;
}
function doBuildAt(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 40;
  const meshes = [...chunkMeshes.values()].filter((m) => m.visible && m.count > 0);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return;
  const k = hit.object.userData.keys[hit.instanceId];
  if (k === undefined) return;
  const [x, y, z] = parseKey(k);
  const reach = player.body.pos.distanceTo(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
  if (reach > 16) { toast('Juda uzoq'); return; }
  if (deleteMode) {
    if (gen.protectedKeys.has(k) || y <= MIN_Y) { toast("Bu blokni o'chirib bo'lmaydi"); return; }
    setBlockAt(x, y, z, null);
    if (online) {
      onlineEdits.set(k, null);
      online.room.sendBlock({ k, t: null });
    } else {
      delete save.added[k];
      if (baseWorld.has(k) && !save.removed.includes(k)) save.removed.push(k);
    }
    sfx('break');
    burst(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), BLOCKS[baseWorld.get(k) ?? buildType].color, 8, 4);
  } else {
    const n = hit.face.normal;
    const nx = x + Math.round(n.x), ny = y + Math.round(n.y), nz = z + Math.round(n.z);
    const nk = key(nx, ny, nz);
    if (world.has(nk) || ny > 70) return;
    if (bodyOverlapsCell(player.body, nx, ny, nz) || (!online && bots.some((b) => bodyOverlapsCell(b.body, nx, ny, nz)))) return;
    setBlockAt(nx, ny, nz, buildType);
    if (online) {
      onlineEdits.set(nk, buildType);
      online.room.sendBlock({ k: nk, t: buildType });
    } else {
      const ri = save.removed.indexOf(nk);
      if (ri >= 0) save.removed.splice(ri, 1);
      if (baseWorld.get(nk) !== buildType) save.added[nk] = buildType;
    }
    sfx('build');
  }
  flushChunks();
  persist();
}

// ---------- Input ----------
const input = { jx: 0, jy: 0, keys: new Set() };
const cam = { yaw: 0, pitch: 0.42, dist: 10 };
let joyId = null, joyOrigin = null;
const camPointers = new Map();
let camStart = null, pinchDist = 0;
const joyBase = $('joyBase'), joyKnob = $('joyKnob'), joyHint = $('joyHint');
const JOY_R = 55;

canvas.addEventListener('pointerdown', (e) => {
  if (!running || paused) return;
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType !== 'mouse' && e.clientX < window.innerWidth * 0.42 && joyId === null
      && !(buildMode && e.clientY < window.innerHeight * 0.5)) {
    joyId = e.pointerId;
    joyOrigin = { x: e.clientX, y: e.clientY };
    joyBase.style.left = e.clientX + 'px'; joyBase.style.top = e.clientY + 'px';
    joyBase.style.display = 'block'; joyHint.style.display = 'none';
    joyKnob.style.transform = 'translate(-50%, -50%)';
    return;
  }
  camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (camPointers.size === 1) camStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  if (camPointers.size === 2) {
    const [a, b] = [...camPointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    camStart = null;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === joyId) {
    let dx = e.clientX - joyOrigin.x, dy = e.clientY - joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
    input.jx = dx / JOY_R; input.jy = dy / JOY_R;
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    return;
  }
  const prev = camPointers.get(e.pointerId);
  if (!prev) return;
  if (camPointers.size >= 2) {
    camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...camPointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.dist = Math.min(24, Math.max(3.5, cam.dist * (pinchDist / (d || 1))));
    pinchDist = d;
    return;
  }
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const sens = e.pointerType === 'mouse' ? 0.006 : 0.008;
  cam.yaw -= dx * sens;
  cam.pitch = Math.min(1.35, Math.max(-0.35, cam.pitch + dy * sens * 0.8));
});
function endPointer(e) {
  if (e.pointerId === joyId) {
    joyId = null; input.jx = 0; input.jy = 0;
    joyBase.style.display = 'none';
    return;
  }
  if (!camPointers.has(e.pointerId)) return;
  camPointers.delete(e.pointerId);
  if (camStart && camStart.id === e.pointerId && e.type === 'pointerup') {
    const moved = Math.hypot(e.clientX - camStart.x, e.clientY - camStart.y);
    const quick = performance.now() - camStart.t < 350;
    if (moved < 12 && quick) {
      if (buildMode) doBuildAt(e.clientX, e.clientY);
      else if (e.pointerType === 'mouse') playerAttack();
    }
  }
  camStart = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { cam.dist = Math.min(24, Math.max(3.5, cam.dist + e.deltaY * 0.01)); }, { passive: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function holdButton(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('pressed'); onDown(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.addEventListener(ev, () => { el.classList.remove('pressed'); if (onUp) onUp(); });
  }
}
holdButton($('jumpBtn'), () => { player.jumpHeld = true; }, () => { player.jumpHeld = false; });
holdButton($('attackBtn'), playerAttack);

window.addEventListener('keydown', (e) => {
  if (!running) return;
  if (e.code === 'Escape') { if (paused) closeMenu(); else openMenu(); return; }
  if (paused) return;
  input.keys.add(e.code);
  if (e.code === 'KeyB') setBuildMode(!buildMode);
  if (e.code === 'KeyX' && buildMode) { deleteMode = !deleteMode; renderBuildBar(); }
  if (e.code === 'KeyR') respawn();
  if (e.code === 'KeyV' && online && !e.repeat) startVoice();
  if (e.code === 'KeyF' || e.code === 'KeyE') playerAttack();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => { input.keys.delete(e.code); if (e.code === 'KeyV') stopVoice(); });
window.addEventListener('blur', () => { input.keys.clear(); player.jumpHeld = false; });

// ---------- Game logic ----------
const WALK_SPEED = 8;
const BOOST_SPEED = 15;
const JUMP_V = 10.5;
const PAD_V = 20;
const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const dirTmp = new THREE.Vector3();

function inArea(p, area) {
  const [x0, y, z0, x1, z1] = area;
  return Math.floor(p.y - 0.05) === y && p.x >= x0 && p.x < x1 + 1 && p.z >= z0 && p.z < z1 + 1;
}

function updatePlayer(dt) {
  const b = player.body;
  player.attackCd -= dt;
  player.invuln -= dt;
  player.padCd -= dt;
  if (player.boostT > 0) player.boostT -= dt;
  player.hurtT -= dt;
  if (player.hurtT <= 0 && player.hp > 0 && player.hp < MAX_HP) {
    player.hp = Math.min(MAX_HP, player.hp + dt * diff().regen);
    updateHpUI();
  }
  if (player.hp <= 0) { b.vel.x *= 0.9; b.vel.z *= 0.9; b.step(dt); player.avatar.update(dt, b.pos, b.vel, b.onGround); return; }

  let mx = input.jx, my = input.jy;
  const k = input.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const speed = b.inWater ? 4.5 : (player.boostT > 0 ? BOOST_SPEED : WALK_SPEED);
  const tx = (fx * -my + rx * mx) * speed;
  const tz = (fz * -my + rz * mx) * speed;
  const accel = b.onGround ? 18 : 8;
  b.vel.x += (tx - b.vel.x) * Math.min(1, dt * accel);
  b.vel.z += (tz - b.vel.z) * Math.min(1, dt * accel);
  const jump = player.jumpHeld || k.has('Space');
  if (jump && b.onGround) { b.vel.y = JUMP_V; sfx('jump'); }
  else if (jump && b.inWater) b.vel.y = 5;
  b.step(dt);

  const under = b.standingOn();
  if (b.pos.y < -25 || (under !== undefined && BLOCKS[under].kill)) {
    toast(b.pos.y < -25 ? 'Yiqildingiz!' : 'Lava! Qaytadan', 1200);
    sfx('die');
    respawn();
    return;
  }
  if (under === T.JUMP && player.padCd <= 0) {
    b.vel.y = PAD_V; player.padCd = 0.3; sfx('pad');
    burst(new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z), 0x76ff03, 8, 4);
  }
  if (under === T.SPEED) {
    if (player.boostT <= 0) sfx('pad');
    player.boostT = 1.6;
  }
  if (under === T.PORTAL) {
    save.cp = null; persist();
    teleport(gen.spawn);
    toast('Markazga qaytdingiz');
    sfx('pad');
    return;
  }
  if (under === T.CHECKPOINT) {
    for (const cp of gen.checkpoints) {
      if (inArea(b.pos, cp.area) && save.cp !== cp.id) {
        const prev = save.cp && checkpointById.get(save.cp);
        if (prev && prev.route === cp.route && prev.stage >= cp.stage) break;
        save.cp = cp.id; persist(); updateStageUI();
        toast(`${cp.label}: ${cp.stage}-nazorat nuqtasi!`);
        sfx('coin');
        break;
      }
    }
  }
  if (under === T.GOLD) {
    for (const f of gen.finishes) {
      if (!inArea(b.pos, f.area) || save.done[f.route]) continue;
      save.done[f.route] = true;
      save.coins += f.reward;
      persist(); updateCoinsUI(); updateStageUI(); updatePlayersUI();
      toast(`G'alaba! ${f.label} tugadi: +${f.reward} Roblon`, 3500);
      sfx('win');
      burst(new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z), 0xffcc33, 30, 9);
    }
  }
  player.avatar.update(dt, b.pos, b.vel, b.onGround);
}

function updateCoins(dt, t) {
  const p = player.body.pos;
  for (const c of coins) {
    if (c.respawnIn > 0) {
      c.respawnIn -= dt;
      if (c.respawnIn <= 0) c.mesh.visible = true;
      continue;
    }
    c.mesh.rotation.y = t * 2.5;
    const dx = c.mesh.position.x - p.x, dy = c.mesh.position.y - (p.y + 0.9), dz = c.mesh.position.z - p.z;
    if (dx * dx + dy * dy + dz * dz < (c.value > 1 ? 2.2 : 1.3)) {
      c.mesh.visible = false;
      c.respawnIn = c.value > 1 ? 120 : 45;
      save.coins += c.value; persist(); updateCoinsUI();
      sfx('coin');
      burst(c.mesh.position, 0xffcc33, c.value > 1 ? 16 : 6, 4);
      if (c.value > 1) toast(`+${c.value} Roblon`, 1200);
    }
  }
}

function updateCamera(dt) {
  camTarget.copy(player.body.pos); camTarget.y += 1.6;
  const cp = Math.cos(cam.pitch);
  dirTmp.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
  let dist = cam.dist;
  for (let s = 0.5; s <= cam.dist; s += 0.25) {
    if (isSolid(camTarget.x + dirTmp.x * s, camTarget.y + dirTmp.y * s, camTarget.z + dirTmp.z * s)) { dist = Math.max(1.2, s - 0.4); break; }
  }
  camDesired.copy(camTarget).addScaledVector(dirTmp, dist);
  camera.position.lerp(camDesired, Math.min(1, dt * 15));
  camera.lookAt(camTarget);
  const p = player.body.pos;
  sun.position.set(p.x + 25, p.y + 50, p.z + 15);
  sun.target.position.copy(p);
}

// ---------- Main loop ----------
let last = performance.now();
let zoneTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  for (const c of clouds) {
    c.position.x += dt * 1.2;
    if (c.position.x > camera.position.x + 200) c.position.x -= 380;
    else if (c.position.x < camera.position.x - 180) c.position.x += 380;
    if (c.position.z > camera.position.z + 160) c.position.z -= 320;
    else if (c.position.z < camera.position.z - 160) c.position.z += 320;
  }
  for (const cl of flagCloths) cl.rotation.y = Math.sin(t * 3) * 0.25;
  water.position.y = WATER_Y + Math.sin(t * 1.2) * 0.04;
  if (running && !paused) {
    updatePlayer(dt);
    const p = player.body.pos;
    const zone = zoneAt(p.x, p.z);
    const safe = (zone && zone.safe) || inObby(p);
    if (!online) for (const b of bots) updateBot(b, dt);
    updateOnline(dt);
    for (const e of enemies) {
      const far = Math.abs(e.home.x - p.x) > 70 || Math.abs(e.home.z - p.z) > 70;
      if (far) { if (!e.dead) e.group.visible = false; continue; }
      if (!e.dead) e.group.visible = true;
      e.update(dt, safe);
    }
    landTimer -= dt;
    if (landTimer < 0) { landTimer = 0.05; if (updateLand(p.x, p.z, 2)) cullTimer = 0; }
    updateCoins(dt, t);
    updateCamera(dt);
    updateParticles(dt);
    playersTimer -= dt;
    if (playersTimer < 0) { playersTimer = 1; updatePlayersUI(); }
    zoneTimer -= dt;
    if (zoneTimer < 0) {
      zoneTimer = 0.5;
      const biome = zone || inObby(p) ? null : biomeAt(p.x, p.z);
      if (zone !== currentZone || biome !== currentBiome) {
        if (zone && zone !== currentZone) toast(zone.name + (zone.safe ? ' (xavfsiz hudud)' : ''), 1500);
        else if (biome && biome !== currentBiome) toast(biome, 1500);
        currentZone = zone; currentBiome = biome;
        updateStageUI();
      }
    }
    mmTimer -= dt;
    if (mmTimer < 0) { mmTimer = 0.15; drawMinimap(); }
    cullTimer -= dt;
    if (cullTimer < 0) { cullTimer = 0.5; cullChunks(p.x, p.z); }
  } else if (!running) {
    camera.position.set(Math.sin(t * 0.08) * 45, 26, Math.cos(t * 0.08) * 45);
    camera.lookAt(0, 4, -10);
    for (const b of bots) updateBot(b, dt);
    cullTimer -= dt;
    if (cullTimer < 0) { cullTimer = 0.5; cullChunks(camera.position.x, camera.position.z); }
  }
  flushChunks();
  renderer.render(scene, camera);
}
applyGraphics();
requestAnimationFrame(frame);
window.roblok = { player, save, bots, enemies, gen, teleport, remotes, updateLand, get online() { return online; } };

document.addEventListener('visibilitychange', () => { last = performance.now(); input.keys.clear(); player.jumpHeld = false; });
