// World generation for Roblok: terrain, roads, zones, obby routes, coins and enemy homes.

export const BLOCKS = [
  { name: 'Maysa', color: 0x58b947 },              // 0 grass
  { name: 'Tosh', color: 0x9aa0a6 },               // 1 stone
  { name: "Yog'och", color: 0x9a6233 },            // 2 wood
  { name: 'Barg', color: 0x2f8a3a },               // 3 leaves
  { name: 'Qum', color: 0xe8d590 },                // 4 sand
  { name: 'Qizil', color: 0xe53935 },              // 5 red
  { name: "Ko'k", color: 0x1e88e5 },               // 6 blue
  { name: 'Sariq', color: 0xfdd835 },              // 7 yellow
  { name: 'Oq', color: 0xf2f2f2 },                 // 8 white
  { name: 'Qora', color: 0x3a3a3a },               // 9 black
  { name: 'Binafsha', color: 0x8e24aa },           // 10 purple
  { name: "To'q sariq", color: 0xfb8c00 },         // 11 orange
  { name: 'Lava', color: 0xff4400, kill: true },   // 12 lava
  { name: 'Oltin', color: 0xffc107 },              // 13 gold / finish
  { name: 'Spawn', color: 0xcfd8dc },              // 14 spawn
  { name: 'Nazorat', color: 0x2de0b0 },            // 15 checkpoint
  { name: 'Tuproq', color: 0x8b5a2b },             // 16 dirt
  { name: 'Asfalt', color: 0x4a4f57 },             // 17 road
  { name: 'Feruza', color: 0x1fb5c4 },             // 18 turquoise tile
  { name: "G'isht", color: 0xc9a26b },             // 19 brick
  { name: 'Lojuvard', color: 0x1c4fa0 },           // 20 lapis tile
  { name: 'Sakrash plitasi', color: 0x76ff03 },    // 21 jump pad
  { name: 'Tezlik plitasi', color: 0x00b0ff },     // 22 speed pad
  { name: 'Portal', color: 0xb388ff },             // 23 teleport to spawn
  { name: 'Qor', color: 0xffffff },                // 24 snow
  { name: 'Butazor', color: 0x1f6b2c },            // 25 hedge
];
export const T = {
  GRASS: 0, STONE: 1, WOOD: 2, LEAVES: 3, SAND: 4, RED: 5, BLUE: 6, YELLOW: 7, WHITE: 8, BLACK: 9,
  PURPLE: 10, ORANGE: 11, LAVA: 12, GOLD: 13, SPAWN: 14, CHECKPOINT: 15, DIRT: 16, ROAD: 17,
  FERUZA: 18, BRICK: 19, LAPIS: 20, JUMP: 21, SPEED: 22, PORTAL: 23, SNOW: 24, HEDGE: 25,
};

export const MAP = 80;          // ground spans x, z in [-MAP, MAP - 1]
export const MIN_Y = -2;
export const WATER_Y = 0.75;
export const LAKE = { x: 0, z: 51, rx: 24, rz: 13 };

// Numeric block keys are much faster than strings in a Map
export const key = (x, y, z) => ((x + 1024) * 256 + (y + 64)) * 2048 + (z + 1024);
export function parseKey(k) {
  const z = (k % 2048) - 1024;
  const t = Math.floor(k / 2048);
  return [Math.floor(t / 256) - 1024, (t % 256) - 64, z];
}

export function inLake(x, z) {
  const dx = (x - LAKE.x) / LAKE.rx, dz = (z - LAKE.z) / LAKE.rz;
  return dx * dx + dz * dz <= 1;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z, scale, seed) {
  const fx = x / scale, fz = z / scale;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const sx = fx - x0, sz = fz - z0;
  const u = sx * sx * (3 - 2 * sx), v = sz * sz * (3 - 2 * sz);
  const a = hash2(x0, z0, seed), b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed), d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const ZONES = [
  { name: 'Markaz', rect: [-10, -10, 10, 10], safe: true, travel: [0.5, 2.1, 3.5] },
  { name: 'Shahar', rect: [-26, -48, 26, -11], travel: [0.5, 1.1, -30] },
  { name: 'Registon', rect: [-34, -80, 34, -49], travel: [0.5, 1.1, -52] },
  { name: 'Osmon minorasi', rect: [28, -52, 52, -28], travel: [40.5, 1.1, -32] },
  { name: 'Obby', rect: [62, -17, 79, 17], safe: true, travel: [66.5, 1.1, 0.5] },
  { name: 'Labirint', rect: [-78, -13, -52, 13], travel: [-48, 1.1, 0.5] },
  { name: "Tog'", rect: [-80, -80, -38, -38], travel: [-36, 1.5, -36] },
  { name: "Ko'l", rect: [-26, 37, 26, 64], travel: [0.5, 1.1, 34] },
  { name: 'Plyaj', rect: [-30, 65, 30, 79], travel: [0.5, 1.1, 70] },
  { name: "O'rmon", rect: [28, 28, 79, 79], travel: [30, 1.5, 30] },
  { name: 'Tepaliklar', rect: [-79, 20, -30, 79], travel: [-32, 2, 32] },
];
export function zoneAt(x, z) {
  for (const zn of ZONES) {
    const [x0, z0, x1, z1] = zn.rect;
    if (x >= x0 && x <= x1 + 1 && z >= z0 && z <= z1 + 1) return zn;
  }
  return null;
}

export function generate() {
  const world = new Map();
  const set = (x, y, z, t) => (t === null ? world.delete(key(x, y, z)) : world.set(key(x, y, z), t));
  const del = (x, y, z) => world.delete(key(x, y, z));
  const fill = (x0, y0, z0, x1, y1, z1, t) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (t === null) del(x, y, z); else set(x, y, z, t);
    }
  };

  const out = {
    world,
    spawn: [0.5, 2.1, 0.5],
    protectedKeys: new Set(),
    coins: [],          // {pos:[x,y,z], value}
    labels: [],         // {text, pos, color}
    checkpoints: [],    // {id, route, stage, area:[x0,y,z0,x1,z1], spawn, label}
    finishes: [],       // {route, label, reward, area}
    flags: [],          // [x,y,z]
    waypoints: [],      // bot destinations
    enemyHomes: [],     // {type, pos}
    topColors: null,    // minimap colors, (2*MAP)^2
  };
  const coin = (x, y, z, value = 1) => out.coins.push({ pos: [x, y, z], value });

  // ---------- Flat areas: terrain is flattened around these ----------
  const rects = [
    [-10, -10, 10, 10], [-3, -52, 3, -10], [-3, 10, 3, 72], [10, -3, 62, 3], [-52, -3, -10, 3],
    [-26, -48, 26, -11], [-34, -78, -6, -49], [6, -78, 34, -49], [-6, -78, 6, -49],
    [28, -52, 52, -28], [62, -17, 79, 17], [-79, -14, -51, 14], [-27, 36, 27, 66], [-32, 64, 32, 79],
  ];
  const segs = [
    [[-9, -9], [-37, -37]], [[9, 9], [30, 30]], [[9, -9], [30, -30]],
  ];
  function flatDist(x, z) {
    let d = Infinity;
    for (const [x0, z0, x1, z1] of rects) {
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      d = Math.min(d, Math.hypot(dx, dz));
    }
    for (const [[ax, az], [bx, bz]] of segs) {
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      d = Math.min(d, Math.max(0, Math.hypot(x - ax - vx * t, z - az - vz * t) - 1.5));
    }
    return d;
  }

  // ---------- Terrain ----------
  const N = MAP * 2;
  const heights = new Int16Array(N * N);
  const H = (x, z) => heights[(x + MAP) * N + (z + MAP)];
  const MOUNT = [-58, -58];
  for (let x = -MAP; x < MAP; x++) for (let z = -MAP; z < MAP; z++) {
    const d = flatDist(x, z);
    const hill = noise(x, z, 24, 7) * 0.7 + noise(x, z, 9, 13) * 0.3;
    const f = Math.max(0, Math.min(1, (d - 2) / 10));
    let h = Math.round(Math.max(0, hill * 9 - 3) * f);
    const dm = Math.hypot(x - MOUNT[0], z - MOUNT[1]);
    h = Math.max(h, Math.floor(23 - dm / 1.35));
    if (inLake(x, z)) h = MIN_Y;
    heights[(x + MAP) * N + (z + MAP)] = h;
    const lakeEdge = ((x - LAKE.x) / (LAKE.rx + 2.5)) ** 2 + ((z - LAKE.z) / (LAKE.rz + 2.5)) ** 2 <= 1;
    let top = T.GRASS;
    if (lakeEdge || (z >= 64 && Math.abs(x) <= 32)) top = T.SAND;
    if (h >= 16) top = T.SNOW;
    else if (h >= 11 && dm < 40) top = T.STONE;
    for (let y = MIN_Y; y <= h; y++) set(x, y, z, y === h ? top : (y >= h - 2 ? T.DIRT : T.STONE));
  }
  const ground = (x, z, t) => set(x, H(x, z), z, t);

  // ---------- Central plaza ----------
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
    const ring = Math.max(Math.abs(x), Math.abs(z));
    set(x, 0, z, ring === 7 ? T.FERUZA : (ring === 3 ? T.LAPIS : T.STONE));
  }
  fill(-1, 1, -1, 1, 1, 1, T.SPAWN);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) out.protectedKeys.add(key(x, 1, z));
  for (const [px, pz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
    fill(px, 1, pz, px, 4, pz, T.STONE);
    set(px, 5, pz, T.YELLOW);
  }
  out.labels.push({ text: 'Shahar · Registon', pos: [0.5, 5, -9], small: true });
  out.labels.push({ text: 'Obby', pos: [9, 5, 0.5], small: true });
  out.labels.push({ text: 'Labirint', pos: [-9, 5, 0.5], small: true });
  out.labels.push({ text: "Ko'l · Plyaj", pos: [0.5, 5, 9], small: true });

  // ---------- Roads ----------
  const road = (x0, z0, x1, z1, alongX) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const center = alongX ? z === 0 : x === 0;
      const along = alongX ? x : z;
      set(x, 0, z, center && ((along % 4) + 4) % 4 < 2 ? T.YELLOW : T.ROAD);
    }
  };
  road(-2, -50, 2, -11, false);
  road(-2, 11, 2, 36, false);
  road(-2, 65, 2, 70, false);
  road(11, -2, 61, 2, true);
  road(-51, -2, -11, 2, true);
  // Bridge over the lake
  for (let z = 37; z <= 64; z++) {
    for (let x = -2; x <= 2; x++) set(x, 0, z, T.WOOD);
    if (z % 3 === 0) { set(-3, 1, z, T.WOOD); set(3, 1, z, T.WOOD); set(-3, 0, z, T.WOOD); set(3, 0, z, T.WOOD); }
    for (let y = MIN_Y; y < 0; y++) if (z % 6 === 0) { set(-2, y, z, T.WOOD); set(2, y, z, T.WOOD); }
  }
  // Dirt trails
  for (const [[ax, az], [bx, bz]] of segs) {
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s <= len; s += 0.5) {
      const cx = ax + ((bx - ax) * s) / len, cz = az + ((bz - az) * s) / len;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const x = Math.round(cx + dx), z = Math.round(cz + dz);
        if (Math.abs(x) > 10 || Math.abs(z) > 10) ground(x, z, T.DIRT);
      }
    }
  }
  out.waypoints.push([0, 0], [0, -30], [0, -50], [30, 0], [55, 0], [-30, 0], [-48, 0], [0, 25], [0, 50],
    [0, 70], [25, 25], [22, -22], [-25, -25], [12, 70], [-12, 70]);

  // ---------- City: houses along the north road ----------
  function house(x0, z0, w, d, h, wall, roof, doorEast) {
    fill(x0, 1, z0, x0 + w - 1, h, z0 + d - 1, wall);
    fill(x0 + 1, 1, z0 + 1, x0 + w - 2, h, z0 + d - 2, null);
    fill(x0 + 1, 0, z0 + 1, x0 + w - 2, 0, z0 + d - 2, T.WOOD);
    const dz = z0 + Math.floor(d / 2);
    const dx = doorEast ? x0 + w - 1 : x0;
    fill(dx, 1, dz, dx, 2, dz, null);
    for (let z = z0 + 2; z < z0 + d - 2; z += 3) set(doorEast ? x0 : x0 + w - 1, 3, z, null);
    for (let x = x0 + 2; x < x0 + w - 2; x += 3) { set(x, 3, z0, null); set(x, 3, z0 + d - 1, null); }
    fill(x0 - 1, h + 1, z0 - 1, x0 + w, h + 1, z0 + d, roof);
    fill(x0 + 1, h + 2, z0 + 1, x0 + w - 2, h + 2, z0 + d - 2, roof);
    coin(x0 + w / 2, 1.9, z0 + d / 2);
  }
  const houses = [
    [-22, -20, 9, 8, 4, T.WHITE, T.RED, true], [-22, -32, 10, 9, 5, T.BRICK, T.LAPIS, true],
    [-20, -45, 8, 8, 4, T.YELLOW, T.BLACK, true], [12, -20, 9, 8, 4, T.BLUE, T.WHITE, false],
    [13, -33, 8, 10, 6, T.WHITE, T.FERUZA, false], [12, -46, 10, 8, 4, T.ORANGE, T.STONE, false],
  ];
  for (const hs of houses) house(...hs);
  out.labels.push({ text: 'Shahar', pos: [0.5, 7, -14], color: '#ffe680' });

  // ---------- Registon ----------
  for (let x = -33; x <= 33; x++) for (let z = -79; z <= -49; z++) {
    set(x, 0, z, (x % 6 === 0 || z % 6 === 0) ? T.FERUZA : T.BRICK);
  }
  function madrasa(cx, cz, dir) {
    const at = (u, w) => (dir === 'N' ? [cx + u, cz - w] : dir === 'W' ? [cx - w, cz + u] : [cx + w, cz - u]);
    const put = (u, v, w, t) => { const [x, z] = at(u, w); if (t === null) del(x, v, z); else set(x, v, z, t); };
    // Body behind the facade
    for (let u = -7; u <= 7; u++) for (let w = 2; w <= 8; w++) for (let v = 1; v <= 9; v++) put(u, v, w, T.BRICK);
    // Pishtaq (portal wall)
    for (let u = -7; u <= 7; u++) for (let v = 1; v <= 13; v++) for (let w = 0; w <= 1; w++) {
      let t = T.BRICK;
      if (v === 12) t = T.FERUZA;
      if (v === 13) t = (u & 1) ? T.LAPIS : T.FERUZA;
      if (w === 0 && (Math.abs(u) === 3 && v <= 10 || v === 10 && Math.abs(u) <= 3)) t = T.FERUZA;
      if (Math.abs(u) <= 2 && v <= 9) t = null;
      put(u, v, w, t);
    }
    // Niche with a lapis back wall
    for (let u = -2; u <= 2; u++) for (let v = 1; v <= 9; v++) {
      put(u, v, 2, null); put(u, v, 3, v > 7 || Math.abs(u) === 2 ? T.FERUZA : T.LAPIS);
    }
    // Minarets
    for (const side of [-1, 1]) {
      for (let a = 0; a <= 1; a++) for (let w = 0; w <= 1; w++) for (let v = 1; v <= 18; v++) {
        put(side * (9 + a), v, w, v === 13 || v >= 17 ? T.FERUZA : (v % 4 === 0 ? T.LAPIS : T.BRICK));
      }
    }
    // Dome
    for (let du = -4; du <= 4; du++) for (let dw = -4; dw <= 4; dw++) for (let dv = 0; dv <= 4; dv++) {
      if (du * du + dw * dw + dv * dv <= 17) put(du, 10 + dv, 5 + dw, dv === 4 ? T.LAPIS : T.FERUZA);
    }
    const [tx, tz] = at(0, 5);
    coin(tx + 0.5, 16.2, tz + 0.5, 5);
    const [nx, nz] = at(0, 2);
    coin(nx + 0.5, 1.9, nz + 0.5);
  }
  madrasa(0, -67, 'N');
  madrasa(-22, -58, 'W');
  madrasa(22, -58, 'E');
  out.labels.push({ text: 'Registon', pos: [0.5, 17, -66], color: '#7fe9f5' });
  for (const [x, z] of [[-8, -55], [8, -55], [0, -60]]) coin(x + 0.5, 1.9, z + 0.5);
  out.waypoints.push([0, -58], [-10, -62], [10, -62]);

  // ---------- Osmon minorasi: a spiral stair around a pillar ----------
  const TX = 40, TZ = -40, LOOP = 12, LOOPS = 3;
  for (let x = 28; x <= 52; x++) for (let z = -52; z <= -28; z++) set(x, 0, z, (x + z) % 2 ? T.STONE : T.WHITE);
  const rainbow = [T.RED, T.ORANGE, T.YELLOW, T.GRASS, T.BLUE, T.PURPLE];
  for (let x = TX - 6; x <= TX + 6; x++) for (let z = TZ - 6; z <= TZ + 6; z++) {
    const r = Math.hypot(x + 0.5 - TX, z + 0.5 - TZ);
    if (r < 2.6) fill(x, 1, z, x, LOOP * LOOPS + 1, z, T.STONE);
    else if (r < 5) {
      const a = (Math.atan2(z + 0.5 - TZ, x + 0.5 - TX) + Math.PI) / (Math.PI * 2);
      for (let L = 0; L < LOOPS; L++) {
        const y = 1 + Math.floor((a + L) * LOOP);
        set(x, y, z, rainbow[Math.floor(y / 6) % rainbow.length]);
      }
    }
  }
  fill(TX - 2, LOOP * LOOPS + 1, TZ - 2, TX + 1, LOOP * LOOPS + 1, TZ + 1, T.GOLD);
  coin(TX, LOOP * LOOPS + 2.9, TZ, 10);
  out.flags.push([TX + 1.5, LOOP * LOOPS + 2, TZ - 1.5]);
  out.labels.push({ text: 'Osmon minorasi', pos: [TX, LOOP * LOOPS + 6, TZ], color: '#ffe680' });
  for (let i = 0; i < 6; i++) coin(TX + 4 * Math.cos(i), 2 + i * 6 + 1.8, TZ + 4 * Math.sin(i));
  out.waypoints.push([TX, TZ + 10]);

  // ---------- Labirint (maze) ----------
  const MX0 = -78, MZ0 = -13, CELLS = 13, MS = CELLS * 2 + 1;
  const open = Array.from({ length: MS }, () => new Array(MS).fill(false));
  {
    const r = rng(2024);
    const stack = [[0, 0]];
    const seen = new Set(['0,0']);
    open[1][1] = true;
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dz]) => [cx + dx, cz + dz, dx, dz])
        .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < CELLS && nz < CELLS && !seen.has(nx + ',' + nz));
      if (!nb.length) { stack.pop(); continue; }
      const [nx, nz, dx, dz] = nb[Math.floor(r() * nb.length)];
      seen.add(nx + ',' + nz);
      open[cx * 2 + 1 + dx][cz * 2 + 1 + dz] = true;
      open[nx * 2 + 1][nz * 2 + 1] = true;
      stack.push([nx, nz]);
    }
    open[MS - 1][13] = true; // east entrance, facing the west road
    for (let i = 11; i <= 15; i++) for (let j = 11; j <= 15; j++) open[i][j] = true; // central room
  }
  for (let i = 0; i < MS; i++) for (let j = 0; j < MS; j++) {
    const x = MX0 + i, z = MZ0 + j;
    set(x, 0, z, T.GRASS);
    if (!open[i][j]) fill(x, 1, z, x, 3, z, T.HEDGE);
  }
  set(MX0 + 13, 1, MZ0 + 13, T.GOLD);
  coin(MX0 + 13.5, 3, MZ0 + 13.5, 10);
  for (const [i, j] of [[1, 1], [1, 25], [25, 1], [25, 25], [7, 19], [19, 7]]) coin(MX0 + i + 0.5, 1.9, MZ0 + j + 0.5);
  out.labels.push({ text: 'Labirint', pos: [-51, 6, 0.5], color: '#b7ff9e' });
  out.enemyHomes.push({ type: 'boss', pos: [MX0 + 13.5, 1, MZ0 + 12.5] });
  out.enemyHomes.push({ type: 'knight', pos: [MX0 + 3.5, 1, MZ0 + 3.5] }, { type: 'knight', pos: [MX0 + 23.5, 1, MZ0 + 23.5] });

  // ---------- Mountain top ----------
  {
    const top = H(MOUNT[0], MOUNT[1]);
    coin(MOUNT[0] + 0.5, top + 1.9, MOUNT[1] + 0.5, 10);
    out.flags.push([MOUNT[0] + 1.5, top + 1, MOUNT[1] + 1.5]);
    out.labels.push({ text: "Tog'", pos: [MOUNT[0], top + 6, MOUNT[1]], color: '#ffffff' });
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1, r = 6 + i * 3;
      const x = Math.round(MOUNT[0] + Math.cos(a) * r), z = Math.round(MOUNT[1] + Math.sin(a) * r);
      if (x >= -MAP && z >= -MAP) coin(x + 0.5, H(x, z) + 1.9, z + 0.5);
    }
    out.enemyHomes.push({ type: 'slime', pos: [-44, 4, -60] }, { type: 'slime', pos: [-60, 4, -44] });
  }

  // ---------- Lake & beach ----------
  out.labels.push({ text: "Ko'l", pos: [-12, 4, 51], color: '#9fd8ff' });
  for (const [x, z] of [[-14, 48], [14, 52], [-8, 58], [10, 44]]) coin(x + 0.5, 0.9, z + 0.5);
  for (let i = -24; i <= 24; i += 8) coin(i + 0.5, 1.9, 74.5);
  out.labels.push({ text: 'Plyaj', pos: [0.5, 5, 72], color: '#ffe680' });
  // Palm-ish trees on the beach
  for (const [x, z] of [[-20, 70], [-10, 76], [16, 72], [26, 68]]) {
    fill(x, 1, z, x, 5, z, T.WOOD);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) set(x + dx, 6, z + dz, T.LEAVES);
    set(x, 6, z, T.LEAVES);
  }

  // ---------- Trees ----------
  const tr = rng(99);
  const tree = (x, z) => {
    const h = H(x, z);
    if (world.get(key(x, h, z)) !== T.GRASS) return;
    const th = 3 + Math.floor(tr() * 3);
    fill(x, h + 1, z, x, h + th, z, T.WOOD);
    fill(x - 1, h + th, z - 1, x + 1, h + th + 1, z + 1, T.LEAVES);
    set(x, h + th + 2, z, T.LEAVES);
    set(x, h + th, z, T.WOOD);
  };
  for (let x = -MAP + 2; x < MAP - 2; x += 3) for (let z = -MAP + 2; z < MAP - 2; z += 3) {
    const jx = x + Math.floor(tr() * 3) - 1, jz = z + Math.floor(tr() * 3) - 1;
    if (flatDist(jx, jz) < 4) continue;
    const forest = jx >= 30 && jz >= 30;
    if (tr() < (forest ? 0.45 : 0.06)) tree(jx, jz);
  }
  // Hidden treasure in the forest
  {
    const x = 56, z = 58, h = H(x, z);
    fill(x - 1, h + 1, z - 1, x + 1, h + 1, z + 1, T.GOLD);
    coin(x + 0.5, h + 2.9, z + 0.5, 15);
    out.labels.push({ text: "O'rmon", pos: [32, 8, 32], color: '#b7ff9e' });
  }
  for (let i = 0; i < 10; i++) {
    const x = 32 + Math.floor(tr() * 44), z = 32 + Math.floor(tr() * 44);
    coin(x + 0.5, H(x, z) + 1.9, z + 0.5);
  }
  out.enemyHomes.push(
    { type: 'slime', pos: [42, 6, 44] }, { type: 'slime', pos: [60, 6, 40] }, { type: 'slime', pos: [48, 6, 64] },
    { type: 'knight', pos: [62, 6, 62] }, { type: 'knight', pos: [38, 6, 60] },
    { type: 'slime', pos: [-45, 6, 40] }, { type: 'slime', pos: [-60, 6, 60] }, { type: 'knight', pos: [-50, 6, 52] },
  );
  // Coins along the roads and on the hills
  for (let z = -46; z <= -14; z += 8) coin(0.5, 1.9, z + 0.5);
  for (let x = 14; x <= 58; x += 8) coin(x + 0.5, 1.9, 0.5);
  for (let x = -48; x <= -14; x += 8) coin(x + 0.5, 1.9, 0.5);
  for (let z = 14; z <= 34; z += 10) coin(0.5, 1.9, z + 0.5);
  for (const [x, z] of [[-40, 30], [-55, 45], [-70, 70], [-35, 60], [-65, 30]]) coin(x + 0.5, H(x, z) + 1.9, z + 0.5);

  // ---------- Obby: three routes of different difficulty ----------
  for (let x = 62; x <= 79; x++) for (let z = -17; z <= 17; z++) set(x, 0, z, T.STONE);
  const ROUTES = [
    { id: 'oson', label: "Oson yo'l", z0: -12, diff: 0, seed: 11, reward: 30, color: '#9dff6a', palette: [T.GRASS, T.YELLOW, T.BLUE] },
    { id: 'orta', label: "O'rta yo'l", z0: 0, diff: 1, seed: 22, reward: 60, color: '#ffe066', palette: [T.ORANGE, T.PURPLE, T.BLUE] },
    { id: 'qiyin', label: "Qiyin yo'l", z0: 12, diff: 2, seed: 33, reward: 120, color: '#ff7a7a', palette: [T.RED, T.BLACK, T.PURPLE] },
  ];
  for (const R of ROUTES) {
    for (let x = 74; x <= 79; x++) for (let z = R.z0 - 1; z <= R.z0 + 1; z++) set(x, 0, z, R.palette[0]);
    out.labels.push({ text: R.label, pos: [76.5, 4, R.z0 + 0.5], color: R.color });
    obbyRoute(R);
  }
  out.labels.push({ text: 'Obby: 3 xil yo\'l', pos: [66, 7, 0.5], color: '#ffffff' });

  function obbyRoute(R) {
    const r = rng(R.seed);
    const segments = [14, 18, 22][R.diff];
    let x = 80, y = 0, z = R.z0, stage = 0, n = 0;
    const plat = (x0, y0, z0, sx, sz, t) => fill(x0, y0, z0, x0 + sx - 1, y0, z0 + sz - 1, t);
    const color = () => R.palette[n++ % R.palette.length];
    const drift = (s) => {
      const dz = Math.round((r() - 0.5) * 2.4);
      const nz = z + dz;
      if (Math.abs(nz - R.z0) <= 3 && Math.abs(nz + s - 1 - R.z0) <= 4) z = nz;
    };
    for (let i = 0; i < segments; i++) {
      if (i > 0 && i % 6 === 0) {
        x += 2;
        plat(x, y, z - 1, 3, 3, T.CHECKPOINT);
        stage++;
        out.checkpoints.push({
          id: R.id + stage, route: R.id, stage, area: [x, y, z - 1, x + 2, z + 1],
          spawn: [x + 1.5, y + 1.1, z + 0.5], label: R.label,
        });
        x += 3;
        continue;
      }
      const k = r();
      if (R.diff === 0 && k < 0.15 || R.diff === 1 && k < 0.1) {
        // Jump pad up to a higher platform
        x += 2; plat(x, y, z, 2, 2, T.JUMP); x += 2;
        x += 2; y += 5; plat(x, y, z - 1, 3, 3, color()); coin(x + 1.5, y + 1.9, z + 0.5); x += 3;
      } else if (R.diff >= 1 && k < (R.diff === 1 ? 0.3 : 0.28)) {
        // Narrow bridge with lava strips to hop over
        const w = R.diff === 1 ? 2 : 1, L = 10;
        x += 2;
        for (let s = 0; s < L; s++) plat(x + s, y, z, 1, w, s % 3 === 2 ? T.LAVA : T.STONE);
        x += L;
      } else if (R.diff === 2 && k < 0.45) {
        // Speed pad run-up and a long jump
        x += 2;
        plat(x, y, z, 2, 1, T.STONE); plat(x + 2, y, z, 2, 1, T.SPEED);
        x += 4; x += 6;
        plat(x, y, z - 1, 6, 3, color()); coin(x + 3, y + 1.9, z + 0.5); x += 6;
      } else {
        const s = [3, 2, 1][R.diff];
        const gap = [1 + Math.floor(r() * 2), 2 + Math.floor(r() * 2), 2 + Math.floor(r() * 2)][R.diff];
        const dy = R.diff === 1 ? Math.floor(r() * 3) - 1 : (r() < 0.35 ? 1 : 0);
        y = Math.max(0, y + dy);
        drift(s);
        x += gap;
        plat(x, y, z, s, s, color());
        if (i % 3 === 1) coin(x + s / 2, y + 1.9, z + s / 2);
        x += s;
      }
    }
    // Finish: gold platform with a portal back to the centre
    x += 2;
    plat(x, y, z - 2, 5, 5, T.GOLD);
    set(x + 4, y, z - 2, T.PORTAL);
    out.finishes.push({ route: R.id, label: R.label, reward: R.reward, area: [x, y, z - 2, x + 4, z + 2] });
    out.flags.push([x + 2.5, y + 1, z + 0.5]);
    out.labels.push({ text: `${R.label}: marra`, pos: [x + 2.5, y + 6, z + 0.5], color: R.color });
    out.labels.push({ text: 'Portal → Markaz', pos: [x + 4.5, y + 2.5, z - 1.5], color: '#d6c2ff', small: true });
  }

  // ---------- Minimap colours ----------
  out.topColors = new Uint32Array(N * N);
  for (let x = -MAP; x < MAP; x++) for (let z = -MAP; z < MAP; z++) {
    let c = 0x2a8fd8;
    if (!inLake(x, z)) {
      for (let y = 45; y >= MIN_Y; y--) {
        const t = world.get(key(x, y, z));
        if (t !== undefined) { c = BLOCKS[t].color; break; }
      }
    }
    out.topColors[(x + MAP) * N + (z + MAP)] = c;
  }
  return out;
}
