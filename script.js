/* =========================================================
   1) YOUR MUSIC — add your songs here
   ---------------------------------------------------------
   Put your music files in the same folder as index.html
   (or in a sub-folder like "music/") and list them below.
   One song = it loops. Several songs = prev/next buttons
   appear and it plays them in order.
   ========================================================= */
const PLAYLIST = [
  { src: "chander_buri.mp3", title: "তুমি নদীর কাছে !" },
  // { src: "music/second-song.mp3", title: "Second Song" },
  // { src: "music/third-song.mp3",  title: "Third Song" },
];


/* =========================================================
   2) THE JOURNEY — places the boat travels through
   ---------------------------------------------------------
   The boat always drifts slowly. A new place slowly
   flows in from upstream (about a minute), then the boat
   stays there PLACE_SECONDS before the next one appears.
   PLACE_ORDER:   the order of places. You can reorder,
   repeat or remove any of: "forest", "mountains", "snow",
   "desert", "village".
   ========================================================= */
const PLACE_SECONDS = 20;
const PLACE_ORDER = ["forest", "mountains", "snow", "desert", "village"];


/* =========================================================
   3) THE SCENE (you don't need to change anything below)
   ========================================================= */

// random numbers (seedable so things drawn twice at tile edges match)
let rng = Math.random;
const R = () => rng();
const rand = (a, b) => a + R() * (b - a);
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scene = document.querySelector(".scene");
const world = document.getElementById("world");
const wctx = world.getContext("2d");
const fx = document.getElementById("fx");
const fctx = fx.getContext("2d");
const boatEl = document.getElementById("boat");
const lanternLight = document.getElementById("lanternLight");
const placeLabel = document.getElementById("placeLabel");
const dawnEl = document.querySelector(".dawn");
const rootStyle = document.documentElement.style;

const BASE_SPEED = 16;          // calm drifting speed of the banks (px/sec)
const WATER_FACTOR = 9 / 16;    // water surface moves a little slower than the banks
const SEAM = 240;               // soft blend between two places
let bankSpeed = BASE_SPEED, waterSpeed = BASE_SPEED * WATER_FACTOR;

let W, H, DPR, FXDPR, TD, TILE, riverW, boatSize, S = 1;
let LITE = false; // lighter mode for phones / slower devices
let ZOOM = 1;                   // phones get the scene drawn a bit bigger
let SMALL = false;              // true on phones
let vwLast = 0, vhLast = 0;
let bankOff = 0, waterOff = 0;
let geom = null;

let ripples = [], reflStars = [], leaves = [], flies = [], flakes = [];
const rings = [];   // circular ripples
const vwake = [];   // V-shaped wake lines

const boat = { x: 0, y: 0, angle: 0, bob: 0, scale: 1 };

/* ---------- river shape (repeats every TILE pixels) ---------- */
function riverCenter(y) {
  const k = (2 * Math.PI) / TILE;
  return W / 2 + W * 0.05 * Math.sin(k * y) + W * 0.022 * Math.sin(3 * k * y + 1.2);
}
function riverHalf(y) {
  const k = (2 * Math.PI) / TILE;
  return (riverW / 2) * (1 + 0.08 * Math.sin(2 * k * y + 0.5) + 0.04 * Math.sin(5 * k * y));
}
const distFromRiver = (x, y) => Math.abs(x - riverCenter(y)) - riverHalf(y);
const edgePoint = (side, y, off) => riverCenter(y) + side * (riverHalf(y) + off);

function buildGeom() {
  const edge = (side) => {
    const pts = [];
    for (let y = -40; y <= TILE + 40; y += 6) pts.push([edgePoint(side, y, 0), y]);
    return pts;
  };
  const L = edge(-1), Rt = edge(1);
  const path = new Path2D();
  L.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  for (let i = Rt.length - 1; i >= 0; i--) path.lineTo(Rt[i][0], Rt[i][1]);
  path.closePath();
  geom = { L, R: Rt, path };
}

/* =========================================================
   Shared drawing helpers for the riverbanks
   ========================================================= */
const ROCK_GREY = ["#4a5054", "#2a2e31", "#16191b"];
const ROCK_SAND = ["#7a6248", "#4a3a2a", "#241a12"];

function newTile() {
  const cv = document.createElement("canvas");
  cv.width = Math.round(W * TD);
  cv.height = Math.round(TILE * TD);
  const c = cv.getContext("2d");
  c.setTransform(TD, 0, 0, TD, 0, 0);
  c.lineJoin = "round";
  c.lineCap = "round";
  return { cv, c };
}

// draw something, plus an identical copy if it crosses the tile's top/bottom edge
function wrapY(y, r, fn) {
  const seed = (Math.random() * 1e9) | 0;
  const copies = [y];
  if (y < r) copies.push(y + TILE);
  if (y > TILE - r) copies.push(y - TILE);
  for (const yy of copies) { rng = seeded(seed); fn(yy); }
  rng = Math.random;
}

function drawItems(items) {
  items.sort((a, b) => a.r - b.r);
  for (const it of items) wrapY(it.y, it.r * 1.8 + 10, it.draw);
}

function strokeLine(c, pts) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.stroke();
}
function strokeEdges(c, color, width) {
  c.strokeStyle = color;
  c.lineWidth = width;
  strokeLine(c, geom.L);
  strokeLine(c, geom.R);
}

function groundFill(c, base, blobs, speckle) {
  c.fillStyle = base;
  c.fillRect(0, 0, W, TILE);
  for (let i = 0; i < 40; i++) {
    const x = rand(0, W), y = rand(0, TILE), r = rand(60, 200);
    const col = blobs[(R() * blobs.length) | 0];
    wrapY(y, r, (yy) => {
      const g = c.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(x - r, yy - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < (W * TILE) / (SMALL ? 420 : 180); i++) {
    c.fillStyle = speckle();
    c.fillRect(rand(0, W), rand(0, TILE), rand(1, 3), rand(1, 3));
  }
}

// bank bands, cut the river out, then shallow-water tint
function cutRiver(c, bands, shallow) {
  for (const [color, w] of bands) strokeEdges(c, color, w);
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = "#000"; // fully opaque, so the river is cut out completely
  c.fill(geom.path);
  c.globalCompositeOperation = "source-over";
  c.save();
  c.clip(geom.path);
  for (const [w, a] of [[80, 0.07], [50, 0.08], [26, 0.09], [10, 0.11]]) strokeEdges(c, `rgba(${shallow},${a})`, w);
  c.restore();
  strokeEdges(c, "rgba(170,190,205,.12)", 1.5);
}

function polygon(c, pts, ox = 0, oy = 0) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x + ox, y + oy) : c.moveTo(x + ox, y + oy)));
  c.closePath();
}

function drawReeds(c, x, y, h0 = 95, h1 = 130) {
  const n = 4 + ((R() * 5) | 0);
  c.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), len = rand(8, 22) * S;
    c.strokeStyle = `hsl(${rand(h0, h1)},${rand(25, 40)}%,${rand(11, 22)}%)`;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a + 0.4) * len * 0.5, y + Math.sin(a + 0.4) * len * 0.5,
                       x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }
}
function edgeReeds(c, prob, h0, h1, o0 = -10, o1 = 14) {
  for (const side of [-1, 1]) {
    for (let y = 0; y < TILE; y += 5) {
      if (R() > prob) continue;
      const x = edgePoint(side, y, rand(o0, o1));
      wrapY(y, 30, (yy) => drawReeds(c, x, yy, h0, h1));
    }
  }
}

function drawRock(c, x, y, r, cols = ROCK_GREY, snow = false) {
  const pts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, rr = r * rand(0.75, 1.1);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85]);
  }
  c.fillStyle = "rgba(0,0,0,.45)";
  polygon(c, pts, r * 0.25, r * 0.3); c.fill();
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r * 1.1);
  g.addColorStop(0, cols[0]);
  g.addColorStop(0.6, cols[1]);
  g.addColorStop(1, cols[2]);
  c.fillStyle = g;
  polygon(c, pts); c.fill();
  if (snow) {
    c.fillStyle = "rgba(225,235,248,.85)";
    c.beginPath(); c.ellipse(x - r * 0.15, y - r * 0.2, r * 0.7, r * 0.5, -0.3, 0, Math.PI * 2); c.fill();
  }
}
function edgeRocks(c, count, cols, o0 = -8, o1 = 20, r0 = 4, r1 = 13, snow = false) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const y = rand(0, TILE), x = edgePoint(side, y, rand(o0, o1)), r = rand(r0, r1) * S;
      wrapY(y, r * 2, (yy) => drawRock(c, x, yy, r, cols, snow));
    }
  }
}

function drawLilyPad(c, x, y, r, flower, prob) {
  c.save();
  c.translate(x, y);
  c.rotate(rand(0, Math.PI * 2));
  const g = c.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
  g.addColorStop(0, "#2a5a32");
  g.addColorStop(1, "#11301c");
  c.fillStyle = g;
  c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, 0.3, Math.PI * 2); c.closePath(); c.fill();
  c.strokeStyle = "rgba(90,140,80,.35)";
  c.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    const a = 0.6 + i * 1.15;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85); c.stroke();
  }
  if (R() < prob) {
    c.fillStyle = flower;
    for (let i = 0; i < 7; i++) {
      c.save();
      c.rotate((i / 7) * Math.PI * 2);
      c.beginPath(); c.ellipse(0, -r * 0.32, r * 0.13, r * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    c.fillStyle = "#f0d06a";
    c.beginPath(); c.arc(0, 0, r * 0.14, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
function edgeLilyPads(c, flower, prob, count = TILE / 110) {
  for (let i = 0; i < count; i++) {
    const side = R() < 0.5 ? -1 : 1;
    const y = rand(0, TILE);
    const baseX = edgePoint(side, y, -rand(18, 55));
    const n = 2 + ((R() * 4) | 0);
    for (let j = 0; j < n; j++) {
      const px = baseX + rand(-20, 20), py = y + rand(-22, 22), r = rand(6, 13) * S;
      wrapY(py, r * 2, (yy) => drawLilyPad(c, px, yy, r, flower, prob));
    }
  }
}

function drawLeafy(c, x, y, r, h0 = 105, h1 = 150, s0 = 18, s1 = 32) {
  c.fillStyle = "rgba(0,0,0,.42)";
  c.beginPath(); c.arc(x + r * 0.2, y + r * 0.25, r * 1.02, 0, Math.PI * 2); c.fill();
  const hue = rand(h0, h1), sat = rand(s0, s1);
  c.fillStyle = `hsl(${hue},${sat}%,6%)`;
  c.beginPath(); c.arc(x, y, r * 0.9, 0, Math.PI * 2); c.fill();
  const lobe = (lx, ly, lr) => {
    const g = c.createRadialGradient(lx - lr * 0.35, ly - lr * 0.4, lr * 0.1, lx, ly, lr);
    g.addColorStop(0, `hsl(${hue},${sat}%,${rand(15, 20)}%)`);
    g.addColorStop(0.6, `hsl(${hue},${sat}%,10%)`);
    g.addColorStop(1, `hsl(${hue},${sat}%,6%)`);
    c.fillStyle = g;
    c.beginPath(); c.arc(lx, ly, lr, 0, Math.PI * 2); c.fill();
  };
  const lobes = 6 + ((R() * 4) | 0);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rand(-0.3, 0.3), d = r * rand(0.35, 0.55);
    lobe(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rand(0.4, 0.6));
  }
  lobe(x - r * 0.1, y - r * 0.1, r * 0.55);
  for (let i = 0; i < r; i++) {
    const a = R() * Math.PI * 2, d = R() * r * 0.9;
    c.fillStyle = `hsla(${hue},${sat}%,${rand(14, 24)}%,.5)`;
    c.fillRect(x + Math.cos(a) * d - r * 0.1, y + Math.sin(a) * d - r * 0.1, 1.5, 1.5);
  }
}

function starPath(c, x, y, r, inner, pts, rot) {
  c.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 + rot;
    const rr = i % 2 ? r * inner : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

function drawPine(c, x, y, r, snowy = false) {
  c.fillStyle = snowy ? "rgba(15,25,45,.45)" : "rgba(0,0,0,.42)";
  c.beginPath(); c.arc(x + r * 0.2, y + r * 0.25, r, 0, Math.PI * 2); c.fill();
  const hue = rand(140, 170);
  for (let layer = 0; layer < 4; layer++) {
    const lr = r * (1 - layer * 0.22);
    const cx = x - layer * r * 0.03, cy = y - layer * r * 0.03;
    starPath(c, cx, cy, lr, 0.62, 14, layer * 0.2);
    c.fillStyle = `hsl(${hue},30%,${6 + layer * 3.5}%)`;
    c.fill();
    if (snowy) {
      starPath(c, cx - lr * 0.06, cy - lr * 0.07, lr * 0.82, 0.55, 14, layer * 0.2 + 0.1);
      c.fillStyle = `rgba(222,234,250,${0.55 - layer * 0.06})`;
      c.fill();
    }
  }
  c.fillStyle = snowy ? "#e6eef8" : "#1b140d";
  c.beginPath(); c.arc(x - r * 0.1, y - r * 0.1, r * (snowy ? 0.09 : 0.06), 0, Math.PI * 2); c.fill();
}

/* ---------- mountain peak seen from above (lit facets + snow cap) ---------- */
function drawPeak(c, x, y, r, cap) {
  const n = 9 + ((R() * 4) | 0);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), rr = r * rand(0.65, 1.12);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9]);
  }
  const sx = x + rand(-0.15, 0.15) * r, sy = y + rand(-0.15, 0.15) * r;
  c.fillStyle = "rgba(0,0,0,.45)";
  polygon(c, pts, r * 0.2, r * 0.25); c.fill();

  const hue = rand(208, 225), sat = rand(7, 14);
  const shadeOf = (mx, my) => {
    const len = Math.hypot(mx, my) || 1;
    return (mx * -0.6 + my * -0.8) / len; // moonlight from the top-left
  };
  const tri = (a, b, col) => {
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.closePath();
    c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 0.8;
    c.fill(); c.stroke();
  };
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const sh = shadeOf((a[0] + b[0]) / 2 - sx, (a[1] + b[1]) / 2 - sy);
    tri(a, b, `hsl(${hue},${sat}%,${15 + 12 * sh}%)`);
  }
  // ridge lines
  c.strokeStyle = "rgba(0,0,0,.12)";
  c.lineWidth = 0.8;
  for (const p of pts) { c.beginPath(); c.moveTo(sx, sy); c.lineTo(p[0], p[1]); c.stroke(); }

  if (cap) {
    const capPts = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const f = rand(0.32, 0.45), f2 = f * rand(0.78, 0.95);
      capPts.push([sx + (a[0] - sx) * f, sy + (a[1] - sy) * f]);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      capPts.push([sx + (m[0] - sx) * f2, sy + (m[1] - sy) * f2]);
    }
    for (let i = 0; i < capPts.length; i++) {
      const a = capPts[i], b = capPts[(i + 1) % capPts.length];
      const sh = shadeOf((a[0] + b[0]) / 2 - sx, (a[1] + b[1]) / 2 - sy);
      tri(a, b, `hsl(212,20%,${58 + 16 * sh}%)`);
    }
  }
}

/* =========================================================
   The five places
   ========================================================= */
function buildForest() {
  const { cv, c } = newTile();
  const features = [];
  groundFill(c, "#07110b", ["rgba(20,35,22,.5)", "rgba(0,0,0,.35)"],
    () => `hsla(${rand(90, 150)},${rand(20, 40)}%,${rand(4, 14)}%,${rand(0.3, 0.7)})`);
  cutRiver(c, [["#14130c", 46], ["#211e14", 20], ["#2e2a1d", 8]], "60,95,100");
  edgeReeds(c, 0.35);
  edgeRocks(c, TILE / 90, ROCK_GREY);
  edgeLilyPads(c, "rgba(235,200,215,.85)", 0.18);

  const items = [];
  for (let i = 0; i < (W * TILE) / 2100; i++) {
    const x = rand(0, W), y = rand(0, TILE), r = rand(22, 50) * S;
    if (distFromRiver(x, y) < 30 - r * 0.35) continue;
    const pine = R() < 0.32;
    items.push({ y, r, draw: (yy) => (pine ? drawPine(c, x, yy, r) : drawLeafy(c, x, yy, r)) });
  }
  // glowing mushrooms on the forest floor
  for (let i = 0; i < TILE / 45; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y);
    if (d < 18 || d > 260) continue;
    wrapY(y, 14, (yy) => drawMushrooms(c, x, yy));
    features.push({ type: "glow", x, y, r: rand(16, 24) * S, ph: rand(0, 6) });
  }
  drawItems(items);
  return { cv, features };
}

function buildMountains() {
  const { cv, c } = newTile();
  const features = [];
  groundFill(c, "#0c0f13", ["rgba(45,50,60,.35)", "rgba(0,0,0,.4)"],
    () => `hsla(${rand(200, 230)},${rand(5, 15)}%,${rand(8, 22)}%,${rand(0.3, 0.7)})`);
  cutRiver(c, [["#141518", 46], ["#23252a", 20], ["#34363c", 8]], "70,95,120");
  edgeRocks(c, TILE / 35, ROCK_GREY, -10, 26, 4, 15);
  edgeReeds(c, 0.1, 120, 160);

  const items = [];
  for (let i = 0; i < (W * TILE) / 3600; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y);
    if (d < 24 || d > 280) continue;
    const r = rand(13, 26) * S;
    items.push({ y, r, draw: (yy) => drawPine(c, x, yy, r) });
  }
  for (let i = 0; i < (W * TILE) / 7000; i++) {
    const x = rand(0, W), y = rand(0, TILE), r = rand(25, 55) * S;
    if (distFromRiver(x, y) < r * 0.4 + 26) continue;
    items.push({ y, r, draw: (yy) => drawPeak(c, x, yy, r, false) });
  }
  for (let i = 0; i < (W * TILE) / 9000; i++) {
    const x = rand(0, W), y = rand(0, TILE), r = rand(60, 150) * S;
    if (distFromRiver(x, y) < r * 0.5 + 40) continue;
    items.push({ y, r, draw: (yy) => drawPeak(c, x, yy, r, r > 85 * S) });
  }
  drawItems(items);
  for (const side of [-1, 1]) {
    const y = rand(200, TILE - 200);
    const x1 = edgePoint(side, y, -4), x0 = edgePoint(side, y - 50, 130 * S);
    drawFallsBase(c, x0, y - 50, x1, y);
    features.push({ type: "falls", x0, dy0: -50, x1, y });
  }
  return { cv, features };
}

function drawFloe(c, x, y, r) {
  const pts = [];
  const n = 6 + ((R() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), rr = r * rand(0.6, 1.1);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  c.fillStyle = "rgba(0,0,0,.25)";
  polygon(c, pts, r * 0.15, r * 0.2); c.fill();
  c.fillStyle = "rgba(205,222,240,.85)";
  c.strokeStyle = "rgba(120,150,180,.6)";
  c.lineWidth = 1;
  polygon(c, pts); c.fill(); c.stroke();
  c.fillStyle = "rgba(240,248,255,.5)";
  c.beginPath(); c.ellipse(x - r * 0.2, y - r * 0.2, r * 0.4, r * 0.25, -0.5, 0, Math.PI * 2); c.fill();
}

function drawCabin(c, x, y, w, h, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  const g = c.createRadialGradient(0, h * 0.9, 0, 0, h * 0.9, w * 1.1);
  g.addColorStop(0, "rgba(255,175,90,.42)");
  g.addColorStop(1, "rgba(255,175,90,0)");
  c.fillStyle = g;
  c.fillRect(-w * 1.2, -w * 0.4, w * 2.4, w * 2.4);
  c.fillStyle = "rgba(10,15,30,.5)";
  c.fillRect(-w / 2 + w * 0.12, -h / 2 + h * 0.18, w, h);
  c.fillStyle = "hsl(212,20%,82%)";
  c.fillRect(-w / 2, -h / 2, w, h / 2);
  c.fillStyle = "hsl(215,22%,56%)";
  c.fillRect(-w / 2, 0, w, h / 2);
  c.strokeStyle = "rgba(40,50,70,.6)";
  c.lineWidth = 1.2;
  c.strokeRect(-w / 2, -h / 2, w, h);
  c.strokeStyle = "rgba(255,255,255,.5)";
  c.beginPath(); c.moveTo(-w / 2, 0); c.lineTo(w / 2, 0); c.stroke();
  c.fillStyle = "#3a2e28";
  c.fillRect(w * 0.18, -h * 0.36, w * 0.13, w * 0.13);
  c.fillStyle = "rgba(255,170,80,.9)";
  c.beginPath(); c.arc(w * 0.245, -h * 0.36 + w * 0.065, w * 0.035, 0, Math.PI * 2); c.fill();
  c.restore();
}

function buildSnow() {
  const { cv, c } = newTile();
  const features = [];
  groundFill(c, "#56667b", ["rgba(160,180,205,.35)", "rgba(30,40,60,.35)"],
    () => (R() < 0.5 ? `rgba(225,238,255,${rand(0.15, 0.5)})` : `rgba(40,55,75,${rand(0.1, 0.3)})`));
  // snow drifts
  for (let i = 0; i < (W * TILE) / 9000; i++) {
    const x = rand(0, W), y = rand(0, TILE), r = rand(20, 70), a0 = rand(0, Math.PI * 2);
    wrapY(y, r + 10, (yy) => {
      c.lineWidth = rand(2, 5);
      c.strokeStyle = "rgba(25,35,55,.25)";
      c.beginPath(); c.arc(x + 3, yy + 4, r, a0, a0 + 1.4); c.stroke();
      c.strokeStyle = "rgba(210,225,245,.22)";
      c.beginPath(); c.arc(x, yy, r, a0, a0 + 1.4); c.stroke();
    });
  }
  // animal tracks in the snow
  for (let i = 0; i < 7; i++) {
    const x0 = rand(0, W), y0 = rand(0, TILE);
    wrapY(y0, 400, (yy) => {
      let x = x0, y = yy, ang = rand(0, Math.PI * 2);
      c.fillStyle = "rgba(30,40,58,.45)";
      for (let k = 0; k < 45; k++) {
        ang += rand(-0.2, 0.2);
        x += Math.cos(ang) * 8; y += Math.sin(ang) * 8;
        const s = k % 2 ? 2.5 : -2.5;
        c.beginPath();
        c.ellipse(x - Math.sin(ang) * s, y + Math.cos(ang) * s, 1.6, 1.1, ang, 0, Math.PI * 2);
        c.fill();
      }
    });
  }
  cutRiver(c, [["#2c3848", 44], ["#7d90a6", 18], ["#b8c8d8", 7]], "150,185,210");
  // ice along the edges of the water
  c.save();
  c.clip(geom.path);
  strokeEdges(c, "rgba(200,222,240,.5)", 26);
  strokeEdges(c, "rgba(232,242,255,.45)", 12);
  c.restore();
  for (let i = 0; i < TILE / 55; i++) {
    const side = R() < 0.5 ? -1 : 1;
    const y = rand(0, TILE), x = edgePoint(side, y, -rand(14, 65)), r = rand(5, 16) * S;
    wrapY(y, r * 2, (yy) => drawFloe(c, x, yy, r));
  }
  edgeRocks(c, TILE / 80, ROCK_GREY, -6, 20, 4, 12, true);

  const items = [];
  for (let i = 0; i < (W * TILE) / 2600; i++) {
    const x = rand(0, W), y = rand(0, TILE), r = rand(16, 38) * S;
    if (distFromRiver(x, y) < 26 - r * 0.3) continue;
    items.push({ y, r, draw: (yy) => drawPine(c, x, yy, r, true) });
  }
  let cabins = 0;
  for (let i = 0; i < 40 && cabins < 3; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y);
    if (d < 60 || d > 220) continue;
    cabins++;
    const w = rand(38, 50) * S, h = w * 0.68, rot = rand(-0.4, 0.4);
    items.push({ y, r: 100, draw: (yy) => drawCabin(c, x, yy, w, h, rot) });
  }
  drawItems(items);
  return { cv, features };
}

function drawDuneRidge(c, x, y, len) {
  const pts = [];
  let ang = rand(-0.5, 0.5) + (R() < 0.5 ? 0 : Math.PI), px = x, py = y;
  for (let i = 0; i < 10; i++) {
    pts.push([px, py]);
    ang += rand(-0.25, 0.25);
    px += (Math.cos(ang) * len) / 9;
    py += ((Math.sin(ang) * len) / 9) * 0.6;
  }
  c.save();
  c.translate(-len * 0.05, -len * 0.05);
  c.lineWidth = len * 0.16;
  c.strokeStyle = "rgba(195,165,118,.13)";
  strokeLine(c, pts);
  c.translate(len * 0.11, len * 0.12);
  c.lineWidth = len * 0.12;
  c.strokeStyle = "rgba(15,10,5,.33)";
  strokeLine(c, pts);
  c.restore();
  c.lineWidth = 1.5;
  c.strokeStyle = "rgba(232,208,162,.32)";
  strokeLine(c, pts);
}

function drawPalm(c, x, y, r) {
  const n = 7 + ((R() * 4) | 0);
  const fronds = [];
  for (let i = 0; i < n; i++) fronds.push([(i / n) * Math.PI * 2 + rand(-0.2, 0.2), r * rand(0.85, 1.1)]);
  const hue = rand(85, 110);
  const frond = (a, len, fill, detail) => {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.5, -len * 0.17, len, 0);
    c.quadraticCurveTo(len * 0.5, len * 0.17, 0, 0);
    c.fillStyle = fill;
    c.fill();
    if (detail) {
      c.strokeStyle = "rgba(0,0,0,.28)";
      c.lineWidth = 0.7;
      for (let t = 0.2; t < 0.95; t += 0.11) {
        const px = len * t, w = len * 0.13 * (1 - t * 0.5);
        c.beginPath(); c.moveTo(px, 0); c.lineTo(px + len * 0.06, -w); c.stroke();
        c.beginPath(); c.moveTo(px, 0); c.lineTo(px + len * 0.06, w); c.stroke();
      }
      c.strokeStyle = `hsla(${hue},30%,32%,.6)`;
      c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(len, 0); c.stroke();
    }
    c.restore();
  };
  c.save();
  c.translate(r * 0.3, r * 0.35);
  for (const [a, len] of fronds) frond(a, len, "rgba(0,0,0,.38)", false);
  c.restore();
  for (const [a, len] of fronds) {
    const sh = Math.cos(a - Math.atan2(-0.8, -0.6));
    frond(a, len, `hsl(${hue},32%,${16 + 6 * sh}%)`, true);
  }
  c.fillStyle = "#3a2a18";
  c.beginPath(); c.arc(x, y, r * 0.12, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#2a2010";
  for (let i = 0; i < 3; i++) {
    const a = rand(0, Math.PI * 2);
    c.beginPath(); c.arc(x + Math.cos(a) * r * 0.1, y + Math.sin(a) * r * 0.1, r * 0.05, 0, Math.PI * 2); c.fill();
  }
}

function drawCactus(c, x, y, r) {
  c.fillStyle = "rgba(0,0,0,.4)";
  c.beginPath(); c.arc(x + r * 0.35, y + r * 0.45, r, 0, Math.PI * 2); c.fill();
  const arms = (R() * 3) | 0;
  for (let i = 0; i < arms; i++) {
    const a = rand(0, Math.PI * 2), ax = x + Math.cos(a) * r * 1.7, ay = y + Math.sin(a) * r * 1.7;
    c.strokeStyle = "hsl(110,22%,14%)";
    c.lineWidth = r * 0.9;
    c.beginPath(); c.moveTo(x, y); c.lineTo(ax, ay); c.stroke();
    c.fillStyle = "hsl(110,22%,20%)";
    c.beginPath(); c.arc(ax, ay, r * 0.55, 0, Math.PI * 2); c.fill();
  }
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, "hsl(105,25%,28%)");
  g.addColorStop(1, "hsl(110,25%,12%)");
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "rgba(0,0,0,.35)";
  c.lineWidth = 0.7;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); c.stroke();
  }
  if (R() < 0.3) {
    c.fillStyle = "#e8a0b8";
    c.beginPath(); c.arc(x, y, r * 0.25, 0, Math.PI * 2); c.fill();
  }
}

function buildDesert() {
  const { cv, c } = newTile();
  const features = [];
  groundFill(c, "#463a2b", ["rgba(110,90,65,.35)", "rgba(20,14,8,.35)"],
    () => `hsla(${rand(28, 40)},${rand(20, 35)}%,${rand(18, 38)}%,${rand(0.2, 0.5)})`);
  // wind ripples in the sand
  c.lineWidth = 1;
  for (let i = 0; i < (W * TILE) / 1800; i++) {
    const x = rand(0, W), y = rand(0, TILE), len = rand(20, 60);
    c.strokeStyle = `rgba(205,175,125,${rand(0.04, 0.1)})`;
    c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + len * 0.3, y - 4, x + len * 0.6, y + 4, x + len, y); c.stroke();
  }
  for (let i = 0; i < (W * TILE) / 26000; i++) {
    const x = rand(0, W), y = rand(0, TILE), len = rand(90, 220) * S;
    wrapY(y, len, (yy) => drawDuneRidge(c, x, yy, len));
  }
  cutRiver(c, [["#2a2216", 46], ["#3a3020", 18], ["#4a3e2a", 7]], "90,110,80");
  edgeReeds(c, 0.45, 65, 100, -6, 26);
  edgeRocks(c, TILE / 110, ROCK_SAND);

  const items = [];
  for (let i = 0; i < (W * TILE) / 7000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y);
    if (d < 8 || d > 95) continue;
    const r = rand(18, 30) * S;
    items.push({ y, r, draw: (yy) => drawPalm(c, x, yy, r) });
  }
  for (let i = 0; i < (W * TILE) / 9000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y);
    if (d < 5 || d > 70) continue;
    const r = rand(7, 13) * S;
    items.push({ y, r, draw: (yy) => drawLeafy(c, x, yy, r, 60, 85, 20, 30) });
  }
  for (let i = 0; i < (W * TILE) / 16000; i++) {
    const x = rand(0, W), y = rand(0, TILE);
    if (distFromRiver(x, y) < 100) continue;
    const r = rand(4, 8) * S;
    items.push({ y, r, draw: (yy) => drawCactus(c, x, yy, r) });
  }
  for (let i = 0; i < (W * TILE) / 30000; i++) {
    const x = rand(0, W), y = rand(0, TILE);
    if (distFromRiver(x, y) < 60) continue;
    const r = rand(6, 18) * S;
    items.push({ y, r, draw: (yy) => drawRock(c, x, yy, r, ROCK_SAND) });
  }
  drawItems(items);
  for (let k = 0, tents = 0; k < 60 && tents < 2; k++) {
    const x = rand(0, W), y = rand(150, TILE - 150), d = distFromRiver(x, y);
    if (d < 55 || d > 110) continue;
    tents++;
    const toRiver = riverCenter(y) > x ? 1 : -1;
    drawTent(c, x, y, 42 * S, 28 * S, rand(-0.3, 0.3));
    const fx = x + toRiver * 36 * S;
    drawFirePit(c, fx, y);
    features.push({ type: "fire", x: fx, y });
  }
  for (let k = 0, ruins = 0; k < 60 && ruins < 2; k++) {
    const x = rand(0, W), y = rand(200, TILE - 200), d = distFromRiver(x, y);
    if (d < 95 || d > 260) continue;
    ruins++;
    drawRuins(c, x, y, rand(-0.4, 0.4));
  }
  return { cv, features };
}

function drawHut(c, x, y, w, h, rot, tin) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = "rgba(70,55,35,.35)";
  c.beginPath(); c.ellipse(0, h * 0.3, w * 0.95, h * 1.15, 0, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(0, h * 0.8, 0, 0, h * 0.8, w * 0.95);
  g.addColorStop(0, "rgba(255,170,80,.45)");
  g.addColorStop(1, "rgba(255,170,80,0)");
  c.fillStyle = g;
  c.fillRect(-w, -h * 0.2, w * 2, w * 2);
  c.fillStyle = "rgba(0,0,0,.45)";
  c.fillRect(-w / 2 + w * 0.1, -h / 2 + h * 0.16, w, h);
  c.fillStyle = tin ? "hsl(210,8%,40%)" : "hsl(42,30%,28%)";
  c.fillRect(-w / 2, -h / 2, w, h / 2);
  c.fillStyle = tin ? "hsl(210,10%,22%)" : "hsl(36,28%,15%)";
  c.fillRect(-w / 2, 0, w, h / 2);
  c.lineWidth = 0.7;
  if (tin) {
    c.strokeStyle = "rgba(0,0,0,.22)";
    for (let px = -w / 2 + 2.5; px < w / 2; px += 2.5) {
      c.beginPath(); c.moveTo(px, -h / 2); c.lineTo(px, h / 2); c.stroke();
    }
  } else {
    for (let i = 0; i < w * 1.2; i++) {
      const px = rand(-w / 2, w / 2), top = R() < 0.5;
      c.strokeStyle = top ? "rgba(255,230,170,.1)" : "rgba(0,0,0,.2)";
      const y0 = top ? rand(-h / 2, -1) : rand(1, h / 2);
      c.beginPath(); c.moveTo(px, y0); c.lineTo(px + rand(-0.5, 0.5), y0 + (top ? -3 : 3)); c.stroke();
    }
  }
  c.strokeStyle = tin ? "rgba(255,255,255,.22)" : "rgba(255,235,190,.25)";
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(-w / 2, 0); c.lineTo(w / 2, 0); c.stroke();
  c.strokeStyle = "rgba(0,0,0,.4)";
  c.strokeRect(-w / 2, -h / 2, w, h);
  c.fillStyle = "#ffd38a";
  c.beginPath(); c.arc(w * 0.3, h * 0.7, 1.6, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawBanana(c, x, y, r) {
  c.fillStyle = "rgba(0,0,0,.4)";
  c.beginPath(); c.arc(x + r * 0.25, y + r * 0.3, r * 0.75, 0, Math.PI * 2); c.fill();
  const n = 6 + ((R() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25), len = r * rand(0.8, 1.05), wd = len * 0.22;
    const sh = Math.cos(a - Math.atan2(-0.8, -0.6));
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.45, -wd, len, 0);
    c.quadraticCurveTo(len * 0.45, wd, 0, 0);
    c.fillStyle = `hsl(${rand(95, 110)},38%,${15 + 5 * sh}%)`;
    c.fill();
    c.strokeStyle = "rgba(190,220,150,.18)";
    c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(len, 0); c.stroke();
    c.strokeStyle = "rgba(0,0,0,.3)";
    c.lineWidth = 0.6;
    for (let k = 0; k < 3; k++) {
      const px = len * rand(0.3, 0.85), side = R() < 0.5 ? -1 : 1;
      c.beginPath(); c.moveTo(px, 0); c.lineTo(px + 2, side * wd * 0.7); c.stroke();
    }
    c.restore();
  }
}

function drawBamboo(c, x, y, r) {
  c.lineWidth = 2;
  for (let i = 0; i < 34; i++) {
    const a = rand(0, Math.PI * 2), d = rand(0, r * 0.4);
    const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
    const la = rand(0, Math.PI * 2), len = r * rand(0.5, 0.9);
    c.strokeStyle = `hsl(${rand(80, 100)},35%,${rand(14, 24)}%)`;
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(la) * len, by + Math.sin(la) * len); c.stroke();
  }
  c.fillStyle = "#2a3a1a";
  for (let i = 0; i < 6; i++) {
    c.beginPath(); c.arc(x + rand(-r * 0.2, r * 0.2), y + rand(-r * 0.2, r * 0.2), 1.6, 0, Math.PI * 2); c.fill();
  }
}

function drawHaystack(c, x, y, r) {
  c.fillStyle = "rgba(0,0,0,.4)";
  c.beginPath(); c.arc(x + r * 0.25, y + r * 0.3, r, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, "hsl(42,35%,32%)");
  g.addColorStop(1, "hsl(38,30%,13%)");
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "rgba(0,0,0,.2)";
  c.lineWidth = 0.8;
  c.beginPath();
  for (let a = 0; a < Math.PI * 6; a += 0.3) {
    const rr = (a / (Math.PI * 6)) * r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.stroke();
  c.fillStyle = "#1a120a";
  c.beginPath(); c.arc(x, y, 1.4, 0, Math.PI * 2); c.fill();
}

function drawPaddy(c, x, y, w, h, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  const flooded = R() < 0.35;
  c.fillStyle = flooded ? "rgba(55,80,95,.55)" : "hsl(95,30%,10%)";
  c.fillRect(-w / 2, -h / 2, w, h);
  c.strokeStyle = flooded ? "rgba(170,195,215,.1)" : "rgba(120,160,80,.12)";
  c.lineWidth = 1;
  for (let py = -h / 2 + 3; py < h / 2; py += 4) {
    c.beginPath(); c.moveTo(-w / 2, py); c.lineTo(w / 2, py); c.stroke();
  }
  c.strokeStyle = "#2a2418";
  c.lineWidth = 3;
  c.strokeRect(-w / 2, -h / 2, w, h);
  c.restore();
}

function drawCanoe(c, x, y, len, ang) {
  const w = len * 0.16;
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = "rgba(0,0,0,.35)";
  c.beginPath(); c.ellipse(3, 4, w * 1.1, len / 2, 0, 0, Math.PI * 2); c.fill();
  const hull = (k) => {
    c.beginPath();
    c.moveTo(0, (-len / 2) * k);
    c.quadraticCurveTo(w * k, -len * 0.2 * k, w * 0.9 * k, len * 0.3 * k);
    c.quadraticCurveTo(0, (len / 2) * k, -w * 0.9 * k, len * 0.3 * k);
    c.quadraticCurveTo(-w * k, -len * 0.2 * k, 0, (-len / 2) * k);
  };
  hull(1); c.fillStyle = "#3a2614"; c.fill();
  hull(0.78); c.fillStyle = "#5a3c22"; c.fill();
  c.strokeStyle = "#3a2614";
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-w * 0.8, 0); c.lineTo(w * 0.8, 0); c.stroke();
  c.restore();
}

function buildVillage() {
  const { cv, c } = newTile();
  const features = [];
  groundFill(c, "#0b150d", ["rgba(25,40,20,.45)", "rgba(0,0,0,.35)"],
    () => `hsla(${rand(80, 130)},${rand(20, 40)}%,${rand(5, 15)}%,${rand(0.3, 0.7)})`);
  for (let i = 0; i < (W * TILE) / 50000; i++) {
    const x = rand(0, W), y = rand(0, TILE);
    if (distFromRiver(x, y) < 200) continue;
    const w = rand(60, 120) * S, h = rand(40, 80) * S, rot = rand(-0.3, 0.3);
    wrapY(y, w, (yy) => drawPaddy(c, x, yy, w, h, rot));
  }
  // footpaths beside the river
  for (const side of [-1, 1]) {
    const pts = [];
    for (let y = -40; y <= TILE + 40; y += 10) {
      pts.push([edgePoint(side, y, (62 + 8 * Math.sin(((2 * Math.PI) / TILE) * 7 * y)) * S), y]);
    }
    c.strokeStyle = "#2c2418"; c.lineWidth = 12 * S; strokeLine(c, pts);
    c.strokeStyle = "rgba(70,58,38,.55)"; c.lineWidth = 5 * S; strokeLine(c, pts);
  }
  cutRiver(c, [["#1a160f", 46], ["#2a241a", 20], ["#3a3224", 8]], "70,100,90");
  edgeReeds(c, 0.25, 90, 125);
  edgeLilyPads(c, "rgba(190,150,235,.9)", 0.4, TILE / 80); // water hyacinth
  for (const side of [-1, 1]) {
    for (let i = 0; i < TILE / 450; i++) {
      const y = rand(0, TILE), x = edgePoint(side, y, -rand(3, 9));
      const x2 = edgePoint(side, y + 5, 0) - edgePoint(side, y, 0);
      const ang = Math.atan2(-x2, 5) + rand(-0.25, 0.25), len = rand(34, 46) * S;
      wrapY(y, len, (yy) => drawCanoe(c, x, yy, len, ang));
    }
  }

  const items = [], houses = [];
  for (let i = 0; i < (W * TILE) / 30000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y);
    if (d < 85 * S || d > 175) continue;
    if (houses.some((hh) => Math.hypot(hh.x - x, hh.y - y) < 70 * S)) continue;
    const w = rand(36, 52) * S, h = rand(26, 34) * S, rot = rand(-0.35, 0.35), tin = R() < 0.4;
    houses.push({ x, y, w });
    items.push({ y, r: 30, draw: (yy) => drawHut(c, x, yy, w, h, rot, tin) });
    if (R() < 0.6) {
      const hx = x + rand(-1, 1) * w, hy = y + rand(0.8, 1.4) * w * (R() < 0.5 ? -1 : 1), hr = rand(7, 11) * S;
      items.push({ y: hy, r: hr, draw: (yy) => drawHaystack(c, hx, yy, hr) });
    }
  }
  const clear = (x, y, r) => !houses.some((hh) => Math.hypot(hh.x - x, hh.y - y) < hh.w * 0.75 + r * 0.5);
  for (let i = 0; i < (W * TILE) / 9000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y), r = rand(16, 26) * S;
    if (d < 30 || d > 220 || !clear(x, y, r)) continue;
    items.push({ y, r, draw: (yy) => drawBanana(c, x, yy, r) });
  }
  for (let i = 0; i < (W * TILE) / 12000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y), r = rand(20, 30) * S;
    if (d < 20 || d > 230 || !clear(x, y, r)) continue;
    items.push({ y, r: r + 20, draw: (yy) => drawPalm(c, x, yy, r) });
  }
  for (let i = 0; i < (W * TILE) / 9000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y), r = rand(24, 46) * S;
    if (d < 40 || d > 280 || !clear(x, y, r)) continue;
    items.push({ y, r, draw: (yy) => drawLeafy(c, x, yy, r) });
  }
  for (let i = 0; i < (W * TILE) / 20000; i++) {
    const x = rand(0, W), y = rand(0, TILE), d = distFromRiver(x, y), r = rand(18, 28) * S;
    if (d < 30 || d > 250 || !clear(x, y, r)) continue;
    items.push({ y, r, draw: (yy) => drawBamboo(c, x, yy, r) });
  }
  drawItems(items);
  return { cv, features };
}

/* ---------- place settings ---------- */
const PLACES = {
  forest:    { name: "Whispering Forest", water: ["#0a1b25", "#040e15"], fireflies: 1,   snow: 0,    aurora: 0, rain: true,  mist: 1,    animals: ["deer", "deer", "fox", "rabbit"], build: buildForest },
  mountains: { name: "Misty Mountains",   water: ["#091627", "#030a13"], fireflies: 0.2, snow: 0.15, aurora: 0, rain: true,  mist: 1.7,  animals: ["deer"],                          build: buildMountains },
  snow:      { name: "Snowy Valley",      water: ["#10263a", "#06111c"], fireflies: 0,   snow: 1,    aurora: 1, rain: false, mist: 1.2,  animals: ["deer", "arctic", "arctic"],      build: buildSnow },
  desert:    { name: "Desert Oasis",      water: ["#0c2123", "#041113"], fireflies: 0,   snow: 0,    aurora: 0, rain: false, mist: 0.35, animals: ["camels"],                        build: buildDesert },
  village:   { name: "Riverside Village", water: ["#0a1a23", "#040e15"], fireflies: 0.8, snow: 0,    aurora: 0, rain: true,  mist: 0.9,  animals: null,                              build: buildVillage },
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
for (const p of Object.values(PLACES)) p.rgb = p.water.map(hexRgb);
const mixRgb = (a, b, q) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], q))).join(",")})`;

/* =========================================================
   Travelling from place to place
   ========================================================= */
const ORDER = PLACE_ORDER.filter((k) => PLACES[k]);
if (!ORDER.length) ORDER.push("forest");
let placeIdx = 0, nextIdx = 1 % ORDER.length;
const tiles = { cur: null, next: null };
let trans = null;       // the moving boundary between the old place and the new one
let placeTimer = 0;
let buildTimer = null;

const buildPlace = (i) => PLACES[ORDER[i]].build();

function scheduleNextBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    const build = () => { if (!tiles.next) tiles.next = buildPlace(nextIdx); };
    if (window.requestIdleCallback) requestIdleCallback(build, { timeout: 4000 });
    else build();
  }, 2500);
}

function showLabel(text) {
  const hint = document.querySelector(".hint");
  if (hint) hint.style.display = "none"; // never overlap the place name
  placeLabel.textContent = text;
  placeLabel.classList.remove("show");
  void placeLabel.offsetWidth;
  placeLabel.classList.add("show");
}

function startTravel() {
  if (!tiles.next) tiles.next = buildPlace(nextIdx);
  trans = { by: 0 }; // the new place starts appearing at the top of the screen
  showLabel(PLACES[ORDER[nextIdx]].name);
}

// the boat never speeds up: the new place simply drifts in with the banks
function updateTravel(dts) {
  bankSpeed = BASE_SPEED;
  if (!trans) {
    placeTimer += dts;
    if (placeTimer >= PLACE_SECONDS) {
      placeTimer = 0;
      startTravel();
    }
    return;
  }
  trans.by += bankSpeed * dts;
  if (trans.by > H + SEAM) {
    tiles.cur = tiles.next;
    tiles.next = null;
    placeIdx = nextIdx;
    nextIdx = (nextIdx + 1) % ORDER.length;
    trans = null;
    bankSpeed = BASE_SPEED;
    scheduleNextBuild();
  }
}

function envMix() {
  const a = PLACES[ORDER[placeIdx]];
  if (!trans) return { a, b: a, q: 0 };
  return { a, b: PLACES[ORDER[nextIdx]], q: smooth(clamp(trans.by / (H + SEAM), 0, 1)) };
}
const envNum = (env, key) => lerp(env.a[key], env.b[key], env.q);
const currentPlace = () => (trans && trans.by > (H + SEAM) * 0.5 ? ORDER[nextIdx] : ORDER[placeIdx]);

// copy rows [y0, y1) of a scrolling tile onto the screen
function drawTileRows(cv, y0, y1, alpha) {
  y0 = Math.max(0, y0);
  y1 = Math.min(H, y1);
  if (y1 <= y0) return;
  const off = mod(bankOff, TILE);
  wctx.globalAlpha = alpha;
  for (const base of [off - TILE, off]) {
    const a = Math.max(y0, base), b = Math.min(y1, base + TILE);
    if (b <= a) continue;
    wctx.drawImage(cv, 0, (a - base) * TD, cv.width, (b - a) * TD, 0, a, W, b - a);
  }
  wctx.globalAlpha = 1;
}

function drawBanks() {
  if (!trans) { drawTileRows(tiles.cur.cv, 0, H, 1); return; }
  const top = trans.by - SEAM; // fully new above this line, blending below it
  drawTileRows(tiles.cur.cv, top, H, 1);
  drawTileRows(tiles.next.cv, 0, top, 1);
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = Math.round(top + (i * SEAM) / N), b = Math.round(top + ((i + 1) * SEAM) / N);
    drawTileRows(tiles.next.cv, a, b, 1 - (i + 0.5) / N);
  }
}

/* =========================================================
   Water
   ========================================================= */
function buildWater() {
  ripples = Array.from({ length: Math.floor((W * TILE) / 2600) }, () => ({
    x: rand(0, W), y: rand(0, TILE), len: rand(8, 28), bend: rand(1, 3),
    a: rand(0.08, 0.2), sp: rand(0.0008, 0.002), ph: rand(0, Math.PI * 2),
  }));
  reflStars = Array.from({ length: Math.floor((W * TILE) / 14000) }, () => ({
    x: rand(0, W), y: rand(0, TILE), r: rand(0.8, 2), a: rand(0.3, 0.9),
    sp: rand(0.0006, 0.002), ph: rand(0, Math.PI * 2),
  }));
  leaves = Array.from({ length: 14 }, () => ({
    x: riverCenter(0) + rand(-riverW * 0.45, riverW * 0.45), y: rand(0, TILE),
    size: rand(5, 9), rot: rand(0, Math.PI * 2), vr: rand(-0.2, 0.2), ph: rand(0, 6),
    color: ["#5a3a1a", "#4a4a1c", "#6b2f1a", "#3f4a22"][(Math.random() * 4) | 0],
  }));
}

function drawWater(t, env) {
  const g = wctx.createLinearGradient(0, 0, 0, H);
  const DAWN_WATER = [[128, 86, 104], [60, 52, 86]];
  for (const i of [0, 1]) {
    const col = env.a.rgb[i].map((v, k) => lerp(lerp(v, env.b.rgb[i][k], env.q), DAWN_WATER[i][k], dawn * 0.55));
    g.addColorStop(i, `rgb(${col.map(Math.round).join(",")})`);
  }
  wctx.fillStyle = g;
  wctx.fillRect(0, 0, W, H);
  if (dawn > 0.01) {
    // the rising sun's warm light on the water
    const sg = wctx.createRadialGradient(W * 0.5, -H * 0.15, 0, W * 0.5, -H * 0.15, H * 1.1);
    sg.addColorStop(0, `rgba(255,175,120,${(0.3 * dawn).toFixed(3)})`);
    sg.addColorStop(1, "rgba(255,175,120,0)");
    wctx.fillStyle = sg;
    wctx.fillRect(0, 0, W, H);
  }

  // star reflections, grouped by brightness so each group is one draw call
  const NB = 5;
  if (dawn < 0.99) {
    for (let b = 0; b < NB; b++) {
      wctx.fillStyle = `rgba(255,250,230,${((0.7 * (1 - dawn) * (b + 0.5)) / NB).toFixed(3)})`;
      wctx.beginPath();
      for (const s of reflStars) {
        const sy = mod(s.y + waterOff, TILE);
        if (sy > H) continue;
        const a = s.a * (0.35 + 0.65 * Math.abs(Math.sin(t * s.sp + s.ph)));
        if (Math.min(NB - 1, (a * NB) | 0) !== b) continue;
        wctx.rect(s.x + Math.sin(t * 0.002 + s.ph) * 1.5, sy, s.r, s.r * 0.8);
      }
      wctx.fill();
    }
  }

  // ripples, also grouped by brightness
  wctx.lineWidth = 1;
  const RMAX = 0.13;
  for (let b = 0; b < NB; b++) {
    wctx.strokeStyle = `rgba(150,190,225,${(((b + 0.5) / NB) * RMAX).toFixed(3)})`;
    wctx.beginPath();
    for (const r of ripples) {
      const sy = mod(r.y + waterOff, TILE);
      if (sy > H + 5) continue;
      const a = 0.65 * r.a * Math.max(0, Math.sin(t * r.sp + r.ph));
      if (a < 0.01 || Math.min(NB - 1, ((a / RMAX) * NB) | 0) !== b) continue;
      wctx.moveTo(r.x - r.len / 2, sy);
      wctx.quadraticCurveTo(r.x, sy - r.bend, r.x + r.len / 2, sy);
    }
    wctx.stroke();
  }

  for (const l of leaves) {
    const sy = mod(l.y + waterOff, TILE);
    if (sy > H + 20) continue;
    l.rot += l.vr * 0.016;
    wctx.save();
    wctx.translate(l.x + Math.sin(t * 0.0008 + l.ph) * 6, sy);
    wctx.rotate(l.rot);
    const s = l.size;
    wctx.fillStyle = l.color;
    wctx.beginPath();
    wctx.moveTo(-s, 0);
    wctx.quadraticCurveTo(0, -s * 0.6, s, 0);
    wctx.quadraticCurveTo(0, s * 0.6, -s, 0);
    wctx.fill();
    wctx.strokeStyle = "rgba(0,0,0,.35)";
    wctx.lineWidth = 0.6;
    wctx.beginPath(); wctx.moveTo(-s, 0); wctx.lineTo(s * 1.3, 0); wctx.stroke();
    wctx.restore();
  }
}

/* ---------- wake + ripple rings ---------- */
function drawWake(dts) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += 11 * dts;
    r.y += waterSpeed * dts;
    r.a -= (r.max / r.life) * dts;
    if (r.a <= 0 || r.y > H + 50) { rings.splice(i, 1); continue; }
    if (r.heart) {
      wctx.strokeStyle = `rgba(255,190,215,${r.a.toFixed(3)})`;
      wctx.lineWidth = 1.4;
      heartPath(wctx, r.x, r.y, r.r);
    } else {
      wctx.strokeStyle = `rgba(175,205,235,${r.a.toFixed(3)})`;
      wctx.lineWidth = 1.2;
      wctx.beginPath();
      wctx.ellipse(r.x, r.y, r.r, r.r * 0.85, 0, 0, Math.PI * 2);
    }
    wctx.stroke();
  }
  for (let i = vwake.length - 1; i >= 0; i--) {
    const p = vwake[i];
    p.x += p.vx * dts;
    p.y += (p.vy + waterSpeed) * dts;
    p.len += 4 * dts;
    p.a -= 0.12 * dts;
    if (p.a <= 0 || p.y > H + 50) { vwake.splice(i, 1); continue; }
    const ang = Math.atan2(p.vy, p.vx) + Math.PI / 2;
    const dx = Math.cos(ang) * p.len, dy = Math.sin(ang) * p.len;
    wctx.strokeStyle = `rgba(185,210,240,${p.a.toFixed(3)})`;
    wctx.lineWidth = 1.2;
    wctx.beginPath();
    wctx.moveTo(p.x - dx, p.y - dy);
    wctx.quadraticCurveTo(p.x + p.vx * 0.05, p.y + p.vy * 0.05, p.x + dx, p.y + dy);
    wctx.stroke();
  }
}

// convert a point on the boat drawing to a screen position
function boatPoint(vx, vy) {
  const s = (boatSize / 320) * boat.scale;
  const dx = (vx - 60) * s, dy = (vy - 150) * s;
  const cos = Math.cos(boat.angle), sin = Math.sin(boat.angle);
  return [boat.x + dx * cos - dy * sin, boat.y + boat.bob + dx * sin + dy * cos];
}
function boatDir(lx, ly) {
  const cos = Math.cos(boat.angle), sin = Math.sin(boat.angle);
  return [lx * cos - ly * sin, lx * sin + ly * cos];
}

let tStern = 0, tBow = 0, tHand = 0, tHandTrail = 0, handTouches = 0;
function emitWake(dts) {
  tStern += dts; tBow += dts; tHand += dts; tHandTrail += dts;
  if (tStern > 1.1) {
    tStern = 0;
    const [x, y] = boatPoint(60, 292);
    rings.push({ x, y, r: 4, a: 0.3, max: 0.3, life: 4.5 });
  }
  if (tBow > 0.16) {
    tBow = 0;
    const [x, y] = boatPoint(60, 6);
    for (const side of [-1, 1]) {
      const [vx, vy] = boatDir(side * 16, 6);
      vwake.push({ x, y, vx, vy, len: 3, a: 0.32 });
    }
  }
  // the girl's fingers trailing in the water
  if (tHand > 1.4 && act.t < 0) {
    tHand = 0;
    const [x, y] = boatPoint(8, 239);
    handTouches++;
    if (handTouches % 5 === 0) rings.push({ x, y, r: 5, a: 0.7, max: 0.7, life: 3.8, heart: true });
    else rings.push({ x, y, r: 1.5, a: 0.3, max: 0.3, life: 2.6 });
  }
  if (tHandTrail > 0.3 && act.t < 0) {
    tHandTrail = 0;
    const [x, y] = boatPoint(7, 240);
    const [vx, vy] = boatDir(-7, 8);
    vwake.push({ x, y, vx, vy, len: 1.5, a: 0.22 });
  }
}

/* ---------- the boatman rowing ---------- */
const oarL = document.getElementById("oarL");
const oarR = document.getElementById("oarR");
const bladeL = document.getElementById("bladeL");
const bladeR = document.getElementById("bladeR");
const armL = document.getElementById("armL");
const armR = document.getElementById("armR");
const handL = document.getElementById("handL");
const handR = document.getElementById("handR");
const upper = document.getElementById("upper");

const ROW_PERIOD = 5.2;
let rowPhase = 0, prevPhase = 0, currentPhi = 0;

function rotPt(px, py, cx, cy, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
const easeInOut = (x) => (1 - Math.cos(Math.PI * x)) / 2;

function bladeRipples(big) {
  const [lx, ly] = rotPt(-73, 204, 14, 145, currentPhi);
  const [rx, ry] = rotPt(193, 204, 106, 145, -currentPhi);
  for (const [x, y] of [boatPoint(lx, ly), boatPoint(rx, ry)]) {
    rings.push({ x, y, r: big ? 3 : 2, a: big ? 0.35 : 0.25, max: big ? 0.35 : 0.25, life: big ? 3.5 : 2.5 });
    if (!big) rings.push({ x, y, r: 0.5, a: 0.2, max: 0.2, life: 2 });
  }
}

// now and then he rests the oars, leans toward her and lets the boat just float
let pauseIn = rand(20, 40), pauseLeft = 0, wantPause = false, rest = 0, waveT = 0, waveW = 0;

function updateRowing(dts) {
  let p;
  const forced = waveT > 0 || act.t >= 0; // he stops rowing to wave, or to watch her
  if (pauseLeft > 0) {
    pauseLeft -= dts;
    p = 0.4;
  } else if (forced) {
    p = rowPhase;
  } else {
    pauseIn -= dts;
    if (pauseIn <= 0) wantPause = true;
    p = (rowPhase + dts / ROW_PERIOD) % 1;
    if (wantPause && rowPhase < 0.4 && p >= 0.4) {
      p = 0.4;
      wantPause = false;
      pauseLeft = rand(4, 6.5);
      pauseIn = rand(25, 45);
    }
  }
  rowPhase = p;
  rest += ((pauseLeft > 0 || forced ? 1 : 0) - rest) * (1 - Math.exp(-dts / 0.5));

  let phi, feather;
  if (p < 0.4) {
    phi = 14 - 32 * easeInOut(p / 0.4);
    feather = 0;
  } else {
    const q = (p - 0.4) / 0.6;
    phi = -18 + 32 * easeInOut(q);
    feather = Math.sin(Math.PI * q);
  }
  phi = lerp(phi, -18, rest);          // oars trail back while resting
  feather = Math.max(feather, rest);   // blades lie flat on the water while resting
  currentPhi = phi;
  oarL.setAttribute("transform", `rotate(${phi.toFixed(2)} 14 145)`);
  oarR.setAttribute("transform", `rotate(${(-phi).toFixed(2)} 106 145)`);
  const ry = (2.4 + 4.1 * feather).toFixed(2);
  bladeL.setAttribute("ry", ry);
  bladeR.setAttribute("ry", ry);

  const lean = lerp(phi * 0.18, 3.2, rest); // leans toward her while resting
  upper.setAttribute("transform", `translate(0 ${lean.toFixed(2)})`);
  let [hlx, hly] = rotPt(46, 123.25, 14, 145, phi);
  let [hrx, hry] = rotPt(74, 123.25, 106, 145, -phi);
  // waving hello
  waveT = Math.max(0, waveT - dts);
  waveW += ((waveT > 0 ? 1 : 0) - waveW) * (1 - Math.exp(-dts / 0.18));
  if (waveW > 0.01) {
    hrx = lerp(hrx, 95 + Math.sin(clockT * 11) * 5, waveW);
    hry = lerp(hry, 101 + Math.cos(clockT * 11) * 2, waveW);
  }
  // holding the top edge of the paper message
  if (banW > 0.01) {
    hlx = lerp(hlx, 30, banW); hly = lerp(hly, 131, banW);
    hrx = lerp(hrx, 90, banW); hry = lerp(hry, 131, banW);
  }
  const sy = 111 + lean;
  armL.setAttribute("d", `M45,${sy} Q${((45 + hlx) / 2 - 6).toFixed(2)},${((sy + hly) / 2 + 2).toFixed(2)} ${hlx.toFixed(2)},${hly.toFixed(2)}`);
  armR.setAttribute("d", `M75,${sy} Q${((75 + hrx) / 2 + 6).toFixed(2)},${((sy + hry) / 2 + 2).toFixed(2)} ${hrx.toFixed(2)},${hry.toFixed(2)}`);
  handL.setAttribute("cx", hlx.toFixed(2)); handL.setAttribute("cy", hly.toFixed(2));
  handR.setAttribute("cx", hrx.toFixed(2)); handR.setAttribute("cy", hry.toFixed(2));

  if (!forced && p < prevPhase) bladeRipples(true);
  if (!forced && prevPhase < 0.4 && p >= 0.4) bladeRipples(false);
  prevPhase = p;
}

/* =========================================================
   Tap the water → water lily
   ========================================================= */
const lilies = [];
const LILY_COLORS = [
  { hue: 335, sat: 80 }, // pink
  { hue: 45,  sat: 30 }, // white
  { hue: 285, sat: 60 }, // lilac
  { hue: 50,  sat: 85 }, // yellow
  { hue: 350, sat: 85 }, // rose
];

function makeSprite(size, draw) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(size * DPR);
  const c = cv.getContext("2d");
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.translate(size / 2, size / 2);
  draw(c);
  return { cv, size };
}

function padSprite(r) {
  return makeSprite(r * 2.4, (c) => {
    c.fillStyle = "rgba(0,0,0,.35)";
    c.beginPath(); c.arc(r * 0.12, r * 0.15, r, 0, Math.PI * 2); c.fill();
    const g = c.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    g.addColorStop(0, "#3c7a44");
    g.addColorStop(1, "#15401f");
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, 0.3, Math.PI * 2); c.closePath(); c.fill();
    c.strokeStyle = "rgba(130,185,110,.4)";
    c.lineWidth = 0.7;
    for (let i = 0; i < 7; i++) {
      const a = 0.55 + i * 0.85;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88); c.stroke();
    }
    c.strokeStyle = "rgba(170,215,150,.22)";
    c.beginPath(); c.arc(0, 0, r - 0.6, 0.3, Math.PI * 2); c.stroke();
  });
}

function flowerSprite(fr, { hue, sat }) {
  return makeSprite(fr * 5.4, (c) => {
    const glow = c.createRadialGradient(0, 0, 0, 0, 0, fr * 2.6);
    glow.addColorStop(0, `hsla(${hue},90%,88%,.6)`);
    glow.addColorStop(0.5, `hsla(${hue},90%,75%,.18)`);
    glow.addColorStop(1, "hsla(0,0%,0%,0)");
    c.fillStyle = glow;
    c.beginPath(); c.arc(0, 0, fr * 2.6, 0, Math.PI * 2); c.fill();
    const layers = [
      { n: 8, len: 1.0,  w: 0.36, rot: 0,           light: 80 },
      { n: 8, len: 0.78, w: 0.3,  rot: Math.PI / 8, light: 89 },
      { n: 6, len: 0.5,  w: 0.24, rot: 0.25,        light: 96 },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        const len = fr * L.len;
        c.save();
        c.rotate(L.rot + (i / L.n) * Math.PI * 2);
        const g = c.createLinearGradient(0, 0, 0, -len);
        g.addColorStop(0, `hsl(${hue},${sat}%,${L.light - 14}%)`);
        g.addColorStop(1, `hsl(${hue},${sat}%,${L.light}%)`);
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(fr * L.w, -len * 0.55, 0, -len);
        c.quadraticCurveTo(-fr * L.w, -len * 0.55, 0, 0);
        c.fill();
        c.restore();
      }
    }
    c.fillStyle = "#ffd85e";
    c.beginPath(); c.arc(0, 0, fr * 0.17, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff2b8";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      c.beginPath(); c.arc(Math.cos(a) * fr * 0.24, Math.sin(a) * fr * 0.24, fr * 0.045, 0, Math.PI * 2); c.fill();
    }
  });
}

// extra soft light added on top, so the flowers glow in the dark
function glowSprite(fr, { hue }) {
  return makeSprite(fr * 7, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, fr * 3.5);
    g.addColorStop(0, `hsla(${hue},90%,75%,.55)`);
    g.addColorStop(0.35, `hsla(${hue},90%,65%,.18)`);
    g.addColorStop(1, "hsla(0,0%,0%,0)");
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, fr * 3.5, 0, Math.PI * 2); c.fill();
  });
}

function isWater(x, y) {
  const ty = mod(y - bankOff, TILE);
  return Math.abs(x - riverCenter(ty)) < riverHalf(ty) - 6;
}

function addLily(x, y) {
  const r = rand(19, 26) * (SMALL ? 0.8 : 1);
  const color = LILY_COLORS[(Math.random() * LILY_COLORS.length) | 0];
  const pads = [{ dx: 0, dy: 0, rot: rand(0, Math.PI * 2), sp: padSprite(r) }];
  const extra = (Math.random() * 3) | 0;
  for (let i = 0; i < extra; i++) {
    const a = rand(0, Math.PI * 2), rr = r * rand(0.55, 0.8);
    pads.push({ dx: Math.cos(a) * (r + rr * 0.9), dy: Math.sin(a) * (r + rr * 0.9), rot: rand(0, Math.PI * 2), sp: padSprite(rr), delay: rand(0.1, 0.4) });
  }
  lilies.push({
    x, y, age: 0, pads,
    flower: flowerSprite(r * 0.78, color),
    glow: glowSprite(r * 0.78, color),
    fdx: rand(-r * 0.15, r * 0.15), fdy: rand(-r * 0.15, r * 0.15),
    rot: rand(0, Math.PI * 2), vr: rand(-0.08, 0.08), ph: rand(0, 6),
  });
  if (lilies.length > 60) lilies.shift();
  rings.push({ x, y, r: 2, a: 0.45, max: 0.45, life: 3 });
  rings.push({ x, y, r: 0.5, a: 0.3, max: 0.3, life: 2.4 });
}

const easeOutBack = (x) => {
  x = clamp(x, 0, 1);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function drawLilies(t, dts) {
  for (let i = lilies.length - 1; i >= 0; i--) {
    const L = lilies[i];
    L.age += dts;
    L.y += waterSpeed * dts;
    L.rot += L.vr * dts;
    if (L.y > H + 60) { lilies.splice(i, 1); continue; }
    const bob = 1 + 0.015 * Math.sin(t * 0.002 + L.ph);
    const x = L.x + Math.sin(t * 0.0007 + L.ph) * 3;
    wctx.save();
    wctx.translate(x, L.y);
    wctx.rotate(L.rot);
    for (const p of L.pads) {
      const s = easeOutBack((L.age - (p.delay || 0)) / 0.7) * bob;
      if (s <= 0) continue;
      wctx.save();
      wctx.translate(p.dx * s, p.dy * s);
      wctx.rotate(p.rot);
      wctx.scale(s, s);
      wctx.drawImage(p.sp.cv, -p.sp.size / 2, -p.sp.size / 2, p.sp.size, p.sp.size);
      wctx.restore();
    }
    const fs = easeOutBack((L.age - 0.35) / 0.9);
    if (fs > 0) {
      wctx.save();
      wctx.translate(L.fdx, L.fdy);
      wctx.rotate((1 - fs) * 0.8);
      wctx.scale(fs * bob, fs * bob);
      wctx.drawImage(L.flower.cv, -L.flower.size / 2, -L.flower.size / 2, L.flower.size, L.flower.size);
      wctx.globalCompositeOperation = "lighter";
      wctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 0.003 + L.ph);
      wctx.drawImage(L.glow.cv, -L.glow.size / 2, -L.glow.size / 2, L.glow.size, L.glow.size);
      wctx.restore();
    }
    wctx.restore();
  }
}

document.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".player, .rotate, .fs-btn")) return;
  const x = e.clientX / ZOOM, y = e.clientY / ZOOM;
  if (tapBoat(x, y)) return;
  if (catchShooter(x, y)) return;
  if (isWater(x, y)) addLily(x, y);
});

/* =========================================================
   Animals on the banks (deer, or camels in the desert)
   ========================================================= */
const animals = [];
let animalTimer = -2.5;

function spawnAnimals() {
  const list = PLACES[currentPlace()].animals;
  if (!list) return;
  const kind = list[(R() * list.length) | 0];
  const side = R() < 0.5 ? -1 : 1;
  const dir = R() < 0.5 ? -1 : 1; // -1 = moving up the screen
  const sc = SMALL ? 1.1 : 1.45;
  if (kind === "deer") {
    const n = 1 + ((R() * 3) | 0), speed = rand(110, 150), dsc = SMALL ? 1.1 : 1.55;
    for (let i = 0; i < n; i++) {
      animals.push({
        kind, side, dir, speed: speed * rand(0.96, 1.04),
        sy: (dir < 0 ? H + 60 : -60) - dir * i * rand(38, 60),
        off: rand(8, 14) + (i % 2) * 8, size: rand(0.9, 1.2) * dsc,
        stag: i === 0 && R() < 0.7, phase: rand(0, Math.PI * 2),
      });
    }
  } else if (kind === "camels") {
    const n = 3 + ((R() * 3) | 0), speed = rand(14, 20), csc = SMALL ? 1 : 1.35;
    for (let i = 0; i < n; i++) {
      animals.push({
        kind, side, dir: 1, speed, sy: -70 - i * 62 * csc,
        off: rand(14, 20), size: rand(0.95, 1.05) * csc,
        saddle: i % 2 === 0, phase: i * 0.9,
      });
    }
  } else if (kind === "fox" || kind === "arctic") {
    animals.push({
      kind, side, dir, speed: rand(60, 85), sy: dir < 0 ? H + 60 : -60,
      off: kind === "arctic" ? rand(25, 55) : rand(6, 14), size: sc * rand(0.9, 1.1),
      phase: rand(0, 6), printT: 0,
    });
  } else if (kind === "rabbit") {
    animals.push({
      kind, side, dir, speed: rand(40, 55), sy: dir < 0 ? H + 60 : -60,
      off: rand(4, 12), size: sc * rand(0.9, 1.1), phase: rand(0, 6),
    });
  }
}

function animalX(d, sy) {
  const ty = mod(sy - bankOff, TILE);
  return riverCenter(ty) + d.side * (riverHalf(ty) + d.off * d.size);
}

function drawDeer(c, d, x, y, ang) {
  const g = Math.sin(d.phase), g2 = Math.sin(d.phase + 0.45);
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(d.size, d.size);
  c.fillStyle = "rgba(0,0,0,.4)";
  c.beginPath(); c.ellipse(3, 4, 7, 15, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#20160d";
  c.lineWidth = 1.8;
  c.lineCap = "round";
  const leg = (hx, hy, tx, ty) => { c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke(); };
  leg(-3.2, -7, -4.2, -9 - 6 * g);
  leg(3.2, -7, 4.2, -9 - 6 * g2);
  leg(-3.2, 8, -4.2, 11 + 6 * g);
  leg(3.2, 8, 4.2, 11 + 6 * g2);
  const body = c.createLinearGradient(-5.5, 0, 5.5, 0);
  body.addColorStop(0, "#3a2818");
  body.addColorStop(0.5, "#a07a52");
  body.addColorStop(1, "#3a2818");
  c.fillStyle = body;
  c.beginPath(); c.ellipse(0, g * 0.3, 5.3, 11.5 + g * 0.8, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "rgba(220,225,240,.18)";
  c.lineWidth = 0.6;
  c.stroke();
  c.strokeStyle = "rgba(20,12,6,.5)";
  c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(0, -9); c.lineTo(0, 9); c.stroke();
  c.fillStyle = "rgba(235,228,212,.9)";
  c.beginPath(); c.ellipse(0, 11.8, 2, 2.6, 0, 0, Math.PI * 2); c.fill();
  const hb = Math.cos(d.phase) * 0.7;
  c.fillStyle = "#7a5a3a";
  c.beginPath(); c.ellipse(0, -13 + hb, 2.8, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#5e4329";
  c.beginPath(); c.ellipse(-3.6, -18.5 + hb, 1.4, 2.6, -0.6, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(3.6, -18.5 + hb, 1.4, 2.6, 0.6, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#8a6844";
  c.beginPath(); c.ellipse(0, -19.5 + hb, 3.2, 4.2, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#3a2a1a";
  c.beginPath(); c.ellipse(0, -23.6 + hb, 1.9, 2.3, 0, 0, Math.PI * 2); c.fill();
  if (d.stag) {
    c.strokeStyle = "#8d7759";
    c.lineWidth = 1.1;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(s * 1.4, -19.5 + hb);
      c.quadraticCurveTo(s * 6.5, -19 + hb, s * 8, -12.5 + hb);
      c.moveTo(s * 5.2, -18 + hb); c.lineTo(s * 7.6, -21.5 + hb);
      c.moveTo(s * 7.4, -14.5 + hb); c.lineTo(s * 10.6, -15.5 + hb);
      c.stroke();
    }
  }
  c.restore();
}

function drawCamel(c, d, x, y, ang) {
  const g = Math.sin(d.phase), g2 = Math.sin(d.phase + Math.PI);
  const hb = Math.cos(d.phase * 2) * 0.6;
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(d.size, d.size);
  c.fillStyle = "rgba(0,0,0,.4)";
  c.beginPath(); c.ellipse(4, 5, 9, 22, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#3a2a1a";
  c.lineWidth = 2.2;
  c.lineCap = "round";
  const leg = (hx, hy, tx, ty) => { c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke(); };
  leg(-4, -8, -5, -12 - 5 * g);
  leg(4, -8, 5, -12 - 5 * g2);
  leg(-4, 9, -5, 13 + 5 * g2);
  leg(4, 9, 5, 13 + 5 * g);
  c.lineWidth = 1;
  leg(0, 12.5, 0, 17 + g * 0.6);
  const body = c.createLinearGradient(-6.5, 0, 6.5, 0);
  body.addColorStop(0, "#4a3622");
  body.addColorStop(0.5, "#b08d60");
  body.addColorStop(1, "#4a3622");
  c.fillStyle = body;
  c.beginPath(); c.ellipse(0, 0, 6.5, 13, 0, 0, Math.PI * 2); c.fill();
  if (d.saddle) {
    c.fillStyle = "#7a1f2a";
    c.strokeStyle = "rgba(230,190,110,.75)";
    c.lineWidth = 0.8;
    c.beginPath(); c.ellipse(0, 0.5, 7.2, 8, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  const hump = c.createRadialGradient(-1.5, -1, 0, 0, 0.5, 5.6);
  hump.addColorStop(0, "#d4ae78");
  hump.addColorStop(1, "#7a5d3c");
  c.fillStyle = hump;
  c.beginPath(); c.arc(0, 0.5, 5.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#9a7650";
  c.beginPath(); c.ellipse(0, -19 + hb, 2.6, 7.5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#7a5a3a";
  c.beginPath(); c.ellipse(-2.6, -25.6 + hb, 1, 1.6, -0.4, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(2.6, -25.6 + hb, 1, 1.6, 0.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#a88358";
  c.beginPath(); c.ellipse(0, -28 + hb, 3.1, 4.6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#6a4d30";
  c.beginPath(); c.ellipse(0, -31.8 + hb, 2.3, 2, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

let lastPlace = null;
const GAIT = { deer: 2.6, camels: 0.7, fox: 3, arctic: 3, rabbit: 1.7 };
const placeNow = document.getElementById("placeNow");
function updateAnimals(dts) {
  const place = currentPlace();
  if (place !== lastPlace) {
    lastPlace = place;
    animalTimer = Math.max(animalTimer, -rand(1, 3));
    // fade the place name under the title out, change it, fade it back in
    placeNow.style.opacity = 0;
    setTimeout(() => { placeNow.textContent = PLACES[place].name; placeNow.style.opacity = 1; }, 700);
  }
  animalTimer += dts;
  if (animalTimer > 0) {
    spawnAnimals();
    animalTimer = (PLACES[place].animals || []).includes("camels") ? -rand(10, 16) : -rand(7, 15);
  }
  drawPrints(dts);
  for (let i = animals.length - 1; i >= 0; i--) {
    const d = animals[i];
    const move = d.kind === "rabbit" ? Math.max(0, Math.sin(d.phase)) * 2.2 : 1; // rabbits hop
    d.sy += (d.dir * d.speed * move + bankSpeed) * dts;
    d.phase += dts * Math.PI * 2 * (GAIT[d.kind] || 2);
    if ((d.dir < 0 && d.sy < -100) || (d.dir > 0 && d.sy > H + 100) || d.sy > H + 600 || d.sy < -600) {
      animals.splice(i, 1);
      continue;
    }
    if (d.sy < -60 || d.sy > H + 60) continue;
    const x = animalX(d, d.sy), x2 = animalX(d, d.sy + d.dir * 6);
    const ang = Math.atan2(x2 - x, -d.dir * 6);
    if (d.kind === "arctic") {
      d.printT += dts;
      if (d.printT > 0.15) {
        d.printT = 0;
        d.foot = -(d.foot || 1);
        prints.push({
          x: x + Math.cos(ang) * d.foot * 2.2 * d.size,
          wy: d.sy + Math.sin(ang) * d.foot * 2.2 * d.size - groundScroll,
          age: 0, s: d.size, a: ang,
        });
      }
    }
    if (d.kind === "deer") drawDeer(wctx, d, x, d.sy, ang);
    else if (d.kind === "camels") drawCamel(wctx, d, x, d.sy, ang);
    else if (d.kind === "rabbit") drawRabbit(wctx, d, x, d.sy, ang);
    else drawFox(wctx, d, x, d.sy, ang);
  }
}

/* =========================================================
   Fish jumping out of the water now and then
   ========================================================= */
const fishes = [], drops = [];
let fishTimer = -rand(3, 6);

function splash(x, y, k) {
  rings.push({ x, y, r: 2, a: 0.45 * k, max: 0.45 * k, life: 2.8 });
  rings.push({ x, y, r: 0.5, a: 0.3 * k, max: 0.3 * k, life: 2.2 });
  for (let i = 0; i < 9; i++) {
    const a = rand(0, Math.PI * 2), v = rand(12, 34) * k;
    drops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, z: 0, vz: rand(20, 40) * k });
  }
}

function waterDepth(x, y) {
  const ty = mod(y - bankOff, TILE);
  return riverHalf(ty) - Math.abs(x - riverCenter(ty));
}

function spawnFish() {
  for (let k = 0; k < 12; k++) {
    const x = rand(0, W), y = rand(H * 0.12, H * 0.88);
    const ang = rand(0, Math.PI * 2), dist = rand(28, 50) * S;
    const ex = x + Math.cos(ang) * dist, ey = y + Math.sin(ang) * dist;
    if (waterDepth(x, y) < 25 || waterDepth(ex, ey) < 25) continue;
    if (Math.hypot(x - boat.x, y - boat.y) < boatSize * 0.6) continue;
    if (Math.hypot(ex - boat.x, ey - boat.y) < boatSize * 0.6) continue;
    fishes.push({ x, y, dx: ex - x, dy: ey - y, ang, len: rand(21, 30) * S, t: 0, dur: rand(0.8, 1.1) });
    splash(x, y, 0.8);
    if (R() < 0.5) pointAt(x + (ex - x) * 0.5, y + (ey - y) * 0.5);
    return;
  }
}

function drawFish(c, f, x, y, h, wag) {
  const s = 1 + 0.45 * h;
  const L = f.len * (0.6 + 0.4 * h) * s, w = f.len * 0.28 * s;
  // shadow on the water
  c.save();
  c.translate(x + h * 7, y + h * 10);
  c.rotate(f.ang);
  c.fillStyle = `rgba(0,0,0,${0.3 * (1 - h * 0.5)})`;
  c.beginPath(); c.ellipse(0, 0, L / 2, w / 2, 0, 0, Math.PI * 2); c.fill();
  c.restore();
  // the fish
  c.save();
  c.translate(x, y);
  c.rotate(f.ang);
  c.beginPath();
  c.moveTo(-L * 0.42, 0);
  c.lineTo(-L * 0.68, -w * 0.55 + wag);
  c.lineTo(-L * 0.62, wag * 0.3);
  c.lineTo(-L * 0.68, w * 0.55 + wag);
  c.closePath();
  c.fillStyle = "#7d8c9c";
  c.fill();
  const g = c.createLinearGradient(0, -w / 2, 0, w / 2);
  g.addColorStop(0, "#e6eef6");
  g.addColorStop(0.5, "#9fb0c2");
  g.addColorStop(1, "#4f5f70");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(L / 2, 0);
  c.quadraticCurveTo(L * 0.1, -w * 0.62, -L * 0.45, wag * 0.2);
  c.quadraticCurveTo(L * 0.1, w * 0.62, L / 2, 0);
  c.fill();
  c.strokeStyle = "rgba(40,55,70,.5)";
  c.lineWidth = 0.7;
  c.beginPath(); c.moveTo(L * 0.3, 0); c.lineTo(-L * 0.35, 0); c.stroke();
  c.fillStyle = "#14181c";
  c.beginPath(); c.arc(L * 0.32, -w * 0.12, Math.max(0.8, w * 0.09), 0, Math.PI * 2); c.fill();
  c.restore();
}

function updateFish(dts) {
  fishTimer += dts;
  if (fishTimer > 0) { spawnFish(); fishTimer = -rand(4, 9); }

  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    f.t += dts;
    f.y += waterSpeed * dts;
    const p = f.t / f.dur;
    if (p >= 1) {
      splash(f.x + f.dx, f.y + f.dy, 1);
      fishes.splice(i, 1);
      continue;
    }
    const h = Math.sin(Math.PI * p);
    drawFish(wctx, f, f.x + f.dx * p, f.y + f.dy * p, h, Math.sin(f.t * 28) * f.len * 0.08);
  }

  wctx.fillStyle = "#dfeaf6";
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.x += d.vx * dts;
    d.y += (d.vy + waterSpeed) * dts;
    d.z += d.vz * dts;
    d.vz -= 90 * dts;
    if (d.z < 0) { drops.splice(i, 1); continue; }
    wctx.globalAlpha = 0.75;
    wctx.beginPath(); wctx.arc(d.x, d.y, 0.8 + d.z * 0.06, 0, Math.PI * 2); wctx.fill();
  }
  wctx.globalAlpha = 1;
}

/* =========================================================
   Dawn (follows your song)
   ---------------------------------------------------------
   In the last part of the song night turns to dawn.
   Without a song it uses a 5-minute clock instead.
   ========================================================= */
let clockT = 0, dawn = 0;

function songProgress() {
  const a = document.getElementById("audio");
  if (a && isFinite(a.duration) && a.duration > 0 && (a.currentTime > 0 || !a.paused)) {
    return a.currentTime / a.duration;
  }
  return (clockT % 300) / 300;
}

function updateSky(dts) {
  clockT += dts;
  const p = songProgress();
  const dawnT = smooth(clamp((p - 0.8) / 0.17, 0, 1));
  dawn += (dawnT - dawn) * (1 - Math.exp(-dts / 2.5));
}

/* =========================================================
   Sprites shared by several effects
   ========================================================= */
let raySprite = null, fireGlow = null, tealGlow = null, fogSprite = null;
function buildSprites() {
  raySprite = document.createElement("canvas");
  raySprite.width = 8;
  raySprite.height = 90;
  const rc = raySprite.getContext("2d");
  const rg = rc.createLinearGradient(0, 0, 0, 90);
  rg.addColorStop(0, "rgba(120,255,190,0)");
  rg.addColorStop(0.3, "rgba(120,255,190,1)");
  rg.addColorStop(0.65, "rgba(90,210,255,.45)");
  rg.addColorStop(1, "rgba(150,100,255,0)");
  rc.fillStyle = rg;
  rc.fillRect(0, 0, 8, 90);

  fireGlow = makeSprite(180 * S, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 90 * S);
    g.addColorStop(0, "rgba(255,160,70,.6)");
    g.addColorStop(0.35, "rgba(255,120,40,.2)");
    g.addColorStop(1, "rgba(255,100,30,0)");
    c.fillStyle = g;
    c.fillRect(-90 * S, -90 * S, 180 * S, 180 * S);
  });
  tealGlow = makeSprite(64, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 32);
    g.addColorStop(0, "rgba(100,255,210,.55)");
    g.addColorStop(0.4, "rgba(80,230,200,.16)");
    g.addColorStop(1, "rgba(80,230,200,0)");
    c.fillStyle = g;
    c.fillRect(-32, -32, 64, 64);
  });
  fogSprite = makeSprite(256, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 128);
    g.addColorStop(0, "rgba(200,212,228,.55)");
    g.addColorStop(0.5, "rgba(200,212,228,.22)");
    g.addColorStop(1, "rgba(200,212,228,0)");
    c.fillStyle = g;
    c.fillRect(-128, -128, 256, 256);
  });
}

/* =========================================================
   Northern lights reflected in the water (snowy valley)
   ========================================================= */
function drawAurora(t, k) {
  k *= 1 - dawn;
  if (k < 0.01) return;
  wctx.save();
  wctx.globalCompositeOperation = "lighter";
  for (let band = 0; band < 3; band++) {
    const baseY = H * (0.16 + band * 0.25);
    for (let x = -10; x < W + 10; x += LITE ? 11 : 7) {
      const y = baseY + Math.sin(x * 0.004 + t * 0.00025 + band * 2) * 55 + Math.sin(x * 0.011 - t * 0.0004 + band) * 22;
      const a = k * (0.11 + 0.08 * Math.sin(x * 0.03 + t * 0.0012 + band * 1.7));
      if (a <= 0.005) continue;
      wctx.globalAlpha = a;
      wctx.drawImage(raySprite, x, y - 20, 9, 70 + 25 * Math.sin(x * 0.02 + t * 0.0007));
    }
  }
  wctx.restore();
}

/* =========================================================
   Shooting stars (reflected in the water) — tap to catch one
   ========================================================= */
const shooters = [], sparkles = [];
let shootTimer = -rand(5, 9);

function spawnShooter() {
  const dir = R() < 0.5 ? 1 : -1;
  const ang = (dir > 0 ? 0 : Math.PI) + dir * rand(0.2, 0.6);
  const sp = rand(380, 520);
  const s = {
    x: rand(W * 0.15, W * 0.85), y: rand(H * 0.05, H * 0.45),
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    age: 0, life: rand(1, 1.5), len: rand(90, 150) * S,
  };
  shooters.push(s);
  pointAt(s.x + s.vx * s.life * 0.4, s.y + s.vy * s.life * 0.4);
}

function updateShooters(dts) {
  shootTimer += dts;
  if (shootTimer > 0) {
    if (dawn < 0.6) spawnShooter();
    shootTimer = -rand(6, 14);
  }
  for (let i = shooters.length - 1; i >= 0; i--) {
    const s = shooters[i];
    s.age += dts;
    s.x += s.vx * dts;
    s.y += s.vy * dts;
    if (s.age > s.life) { shooters.splice(i, 1); continue; }
    const fade = Math.sin((Math.PI * s.age) / s.life);
    const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
    const tx = s.x - ux * s.len, ty = s.y - uy * s.len;
    const g = wctx.createLinearGradient(s.x, s.y, tx, ty);
    g.addColorStop(0, `rgba(255,255,240,${(0.9 * fade).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,255,240,0)");
    wctx.strokeStyle = g;
    wctx.lineWidth = 2;
    wctx.beginPath(); wctx.moveTo(s.x, s.y); wctx.lineTo(tx, ty); wctx.stroke();
    wctx.fillStyle = `rgba(255,255,245,${fade.toFixed(3)})`;
    wctx.beginPath(); wctx.arc(s.x, s.y, 2, 0, Math.PI * 2); wctx.fill();
  }
}

function catchShooter(x, y) {
  for (let i = 0; i < shooters.length; i++) {
    const s = shooters[i];
    const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
    const along = clamp(-((x - s.x) * ux + (y - s.y) * uy), 0, s.len);
    const cx = s.x - ux * along, cy = s.y - uy * along;
    if (Math.hypot(x - cx, y - cy) < 40) {
      sparkle(s.x, s.y);
      shooters.splice(i, 1);
      return true;
    }
  }
  return false;
}

function sparkle(x, y) {
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2), v = rand(20, 90);
    sparkles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: rand(0.8, 1.6), r: rand(2, 5), rot: rand(0, 3) });
  }
  sparkles.push({ x, y, vx: 0, vy: 0, age: 0, life: 1.2, r: 16, rot: 0, big: true });
}

function star4(c, x, y, r, rot) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4, rr = i % 2 ? r * 0.22 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

function drawSparkles(dts) {
  if (!sparkles.length) return;
  fctx.save();
  fctx.globalCompositeOperation = "lighter";
  fctx.fillStyle = "#fff4c8";
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const s = sparkles[i];
    s.age += dts;
    if (s.age > s.life) { sparkles.splice(i, 1); continue; }
    s.x += s.vx * dts; s.y += s.vy * dts;
    s.vx *= 0.97; s.vy *= 0.97;
    const k = 1 - s.age / s.life;
    fctx.globalAlpha = k;
    star4(fctx, s.x, s.y, s.r * (s.big ? 0.6 + s.age : 0.6 + 0.4 * k), s.rot + s.age * 2);
  }
  fctx.restore();
}

/* =========================================================
   Weather: light rain showers and thick fog now and then
   ========================================================= */
const weather = { kind: "clear", timer: rand(35, 60), rain: 0, fog: 0 };
const rainRings = [];
let rainDrops = [], fogBlobs = [];

function updateWeather(dts) {
  weather.timer -= dts;
  if (weather.timer <= 0) {
    if (weather.kind === "clear") {
      weather.kind = PLACES[currentPlace()].rain && R() < 0.55 ? "rain" : "fog";
      weather.timer = rand(20, 32);
    } else {
      weather.kind = "clear";
      weather.timer = rand(40, 75);
    }
  }
  const k = 1 - Math.exp(-dts / 4);
  const rainT = weather.kind === "rain" && PLACES[currentPlace()].rain ? 1 : 0;
  weather.rain += (rainT - weather.rain) * k;
  weather.fog += ((weather.kind === "fog" ? 1 : 0) - weather.fog) * k;
}

function buildWeatherFX() {
  rainDrops = Array.from({ length: SMALL ? 90 : 170 }, () => ({
    x: rand(0, W), y: rand(0, H), l: rand(6, 12), v: rand(500, 700),
  }));
  fogBlobs = Array.from({ length: 9 }, () => ({
    x: rand(-0.2, 1.2), y: rand(-0.1, 1.1), s: rand(1.6, 3.2),
    vx: rand(0.004, 0.012) * (R() < 0.5 ? -1 : 1), ph: rand(0, 6),
  }));
}

// tiny rings where raindrops hit the water
function drawRainRings(dts) {
  if (weather.rain > 0.02) {
    let n = weather.rain * 70 * dts;
    while (n > 0) {
      if (n >= 1 || R() < n) {
        const x = rand(0, W), y = rand(0, H);
        if (isWater(x, y)) rainRings.push({ x, y, r: 0.5, age: 0, life: rand(0.6, 0.9) });
      }
      n -= 1;
    }
  }
  wctx.lineWidth = 0.8;
  for (let i = rainRings.length - 1; i >= 0; i--) {
    const r = rainRings[i];
    r.age += dts;
    if (r.age > r.life) { rainRings.splice(i, 1); continue; }
    r.r += 9 * dts;
    r.y += waterSpeed * dts;
    wctx.strokeStyle = `rgba(190,215,240,${(0.35 * (1 - r.age / r.life)).toFixed(3)})`;
    wctx.beginPath(); wctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); wctx.stroke();
  }
}

function drawWeatherFX(t, dts) {
  if (weather.rain > 0.02) {
    fctx.strokeStyle = "rgba(200,220,245,.35)";
    fctx.lineWidth = 1;
    fctx.globalAlpha = weather.rain;
    fctx.beginPath();
    for (const d of rainDrops) {
      d.y += d.v * dts;
      d.x += d.v * 0.18 * dts;
      if (d.y > H + 10) { d.y = -10; d.x = rand(-50, W); }
      fctx.moveTo(d.x, d.y);
      fctx.lineTo(d.x - d.l * 0.18, d.y - d.l);
    }
    fctx.stroke();
    fctx.globalAlpha = 1;
  }
  if (weather.fog > 0.02) {
    for (const b of fogBlobs) {
      b.x += b.vx * dts;
      if (b.x > 1.4) b.x = -0.4;
      if (b.x < -0.4) b.x = 1.4;
      b.y += (bankSpeed * 0.5 * dts) / H;
      if (b.y > 1.3) b.y = -0.3;
      const sz = 256 * b.s * (SMALL ? 0.8 : 1);
      fctx.globalAlpha = weather.fog * (0.75 + 0.25 * Math.sin(t * 0.0004 + b.ph));
      fctx.drawImage(fogSprite.cv, b.x * W - sz / 2, b.y * H - sz / 2, sz, sz);
    }
    fctx.globalAlpha = 1;
  }
}

/* =========================================================
   Birds: a V of white egrets, or an owl gliding across
   ========================================================= */
const flocks = [];
let birdTimer = -rand(10, 18);

function spawnBirds() {
  const owl = R() < 0.35;
  const fromLeft = R() < 0.5;
  const y0 = rand(H * 0.15, H * 0.85), y1 = rand(H * 0.1, H * 0.9);
  const x0 = fromLeft ? -80 : W + 80, x1 = fromLeft ? W + 80 : -80;
  const dist = Math.hypot(x1 - x0, y1 - y0), sp = owl ? 55 : 75;
  const members = [];
  if (owl) members.push({ ox: 0, oy: 0, ph: 0 });
  else {
    const n = 5 + ((R() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const k = Math.ceil(i / 2), side = i % 2 ? -1 : 1;
      members.push({ ox: i ? side * k * 15 : 0, oy: k * 14, ph: rand(0, 6) });
    }
  }
  flocks.push({
    owl, x: x0, y: y0, vx: ((x1 - x0) / dist) * sp, vy: ((y1 - y0) / dist) * sp,
    members, t: 0, s: (SMALL ? 0.9 : 1.15) * (owl ? 1.25 : 1),
  });
}

function drawEgret(c, ph) {
  const f = Math.cos(ph);
  const span = 13 * (0.55 + 0.45 * Math.abs(f)), sweep = f * 3;
  c.fillStyle = "#f4f2ea";
  c.strokeStyle = "rgba(150,150,165,.55)";
  c.lineWidth = 0.5;
  for (const side of [-1, 1]) {
    c.beginPath();
    c.moveTo(side * 1.5, -3);
    c.quadraticCurveTo(side * span * 0.6, -5 + sweep, side * span, -1 + sweep);
    c.quadraticCurveTo(side * span * 0.55, 3 + sweep * 0.5, side * 1.5, 3);
    c.fill(); c.stroke();
  }
  c.fillStyle = "#fbfaf5";
  c.beginPath(); c.ellipse(0, 0, 2.2, 6, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(0, -7.5, 1.6, 2, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#e8c040"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, -9.4); c.lineTo(0, -13); c.stroke();
  c.strokeStyle = "#2a2a2a"; c.lineWidth = 0.7;
  c.beginPath(); c.moveTo(-0.6, 5); c.lineTo(-0.8, 12); c.moveTo(0.6, 5); c.lineTo(0.8, 12); c.stroke();
}

function drawOwl(c, ph) {
  const f = Math.cos(ph);
  const span = 16 * (0.75 + 0.25 * Math.abs(f));
  c.fillStyle = "#6b5640";
  for (const side of [-1, 1]) {
    c.beginPath();
    c.moveTo(side * 2.5, -3);
    c.quadraticCurveTo(side * span * 0.7, -7, side * span, -1);
    c.quadraticCurveTo(side * span * 0.8, 5, side * 2.5, 5);
    c.fill();
    c.strokeStyle = "rgba(40,28,18,.6)";
    c.lineWidth = 0.7;
    for (let k = 0.35; k < 1; k += 0.2) {
      c.beginPath(); c.moveTo(side * span * k, -4 + k * 2); c.lineTo(side * span * k, 3); c.stroke();
    }
  }
  c.fillStyle = "#7a6248";
  c.beginPath(); c.ellipse(0, 1, 4, 6.5, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(-3, 6); c.lineTo(0, 11); c.lineTo(3, 6); c.closePath(); c.fill();
  c.fillStyle = "#8a7258";
  c.beginPath(); c.arc(0, -6, 4, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#3e2f20";
  c.beginPath(); c.arc(-1.4, -8.6, 0.6, 0, Math.PI * 2); c.arc(1.4, -8.6, 0.6, 0, Math.PI * 2); c.fill();
}

function drawBirds(dts) {
  birdTimer += dts;
  if (birdTimer > 0) { spawnBirds(); birdTimer = -rand(22, 40); }
  for (let i = flocks.length - 1; i >= 0; i--) {
    const f = flocks[i];
    f.t += dts;
    f.x += f.vx * dts;
    f.y += f.vy * dts;
    if (f.x < -220 || f.x > W + 220) { flocks.splice(i, 1); continue; }
    const ang = Math.atan2(f.vx, -f.vy), cos = Math.cos(ang), sin = Math.sin(ang);
    for (const m of f.members) {
      const x = f.x + m.ox * cos - m.oy * sin, y = f.y + m.ox * sin + m.oy * cos;
      const ph = f.owl ? (Math.sin(f.t * 0.8) > 0.6 ? f.t * 9 : 0) : f.t * 7 + m.ph;
      fctx.fillStyle = "rgba(0,0,0,.13)";
      fctx.beginPath(); fctx.ellipse(x + 26, y + 36, 10 * f.s, 4 * f.s, ang, 0, Math.PI * 2); fctx.fill();
      fctx.save();
      fctx.translate(x, y);
      fctx.rotate(ang);
      fctx.scale(f.s, f.s);
      if (f.owl) drawOwl(fctx, ph); else drawEgret(fctx, ph);
      fctx.restore();
    }
  }
}

/* =========================================================
   Fireflies that drift into the boat and circle the couple
   ========================================================= */
const visitors = [];
let visitTimer = -rand(15, 25);

function spawnVisitors() {
  const side = R() < 0.5 ? -1 : 1;
  const ty = mod(boat.y - bankOff, TILE);
  for (let i = 0; i < 4; i++) {
    visitors.push({
      sx: edgePoint(side, ty, rand(20, 60)), sy: boat.y + rand(-120, 120),
      ex: edgePoint(-side, ty, rand(30, 80)), ey: boat.y + rand(-150, 150),
      t: -i * 0.6, a0: rand(0, Math.PI * 2), w: rand(0.5, 0.9) * (R() < 0.5 ? 1 : -1),
      rx: rand(0.09, 0.14), ry: rand(0.07, 0.11), bph: rand(0, 6),
    });
  }
}

function drawVisitors(t, dts, level) {
  visitTimer += dts;
  if (visitTimer > 0) {
    visitTimer = -rand(28, 45);
    if (level > 0.3 && !visitors.length) spawnVisitors();
  }
  const IN = 4.5, ORBIT = 14, OUT = 5;
  const [cx, cy] = boatPoint(60, 205);
  for (let i = visitors.length - 1; i >= 0; i--) {
    const v = visitors[i];
    v.t += dts;
    if (v.t < 0) continue;
    if (v.t > IN + ORBIT + OUT) { visitors.splice(i, 1); continue; }
    const a = v.a0 + v.t * v.w;
    const ox = cx + Math.cos(a) * boatSize * v.rx + Math.sin(v.t * 1.7) * 4;
    const oy = cy + Math.sin(a) * boatSize * v.ry + Math.cos(v.t * 1.3) * 4;
    let x, y;
    if (v.t < IN) {
      const e = easeInOut(v.t / IN);
      x = lerp(v.sx, ox, e); y = lerp(v.sy, oy, e);
    } else if (v.t < IN + ORBIT) {
      x = ox; y = oy;
      if (v.t + dts >= IN + ORBIT) { v.lx = ox; v.ly = oy; }
    } else {
      const e = easeInOut((v.t - IN - ORBIT) / OUT);
      x = lerp(v.lx ?? ox, v.ex, e); y = lerp(v.ly ?? oy, v.ey, e);
    }
    const glow = (0.45 + 0.55 * Math.max(0, Math.sin(t * 0.003 + v.bph))) * clamp(level * 1.4, 0, 1);
    fctx.globalAlpha = glow * 0.3;
    fctx.fillStyle = "#d8ff8a";
    fctx.beginPath(); fctx.arc(x, y, 8, 0, Math.PI * 2); fctx.fill();
    fctx.globalAlpha = glow;
    fctx.fillStyle = "#f6ffd0";
    fctx.beginPath(); fctx.arc(x, y, 1.8, 0, Math.PI * 2); fctx.fill();
  }
  fctx.globalAlpha = 1;
}

/* =========================================================
   The girl points at shooting stars and jumping fish
   ========================================================= */
const gArm = document.getElementById("gArm");
const gHand = document.getElementById("gHand");
const gLotus = document.getElementById("gLotus");
const girl = { w: 0, timer: 0, dir: [0, -1] };

function pointAt(x, y) {
  if (girl.timer > 0 || act.t >= 0) return;
  const [sx, sy] = boatPoint(72, 244);
  const vx = x - sx, vy = y - sy, cos = Math.cos(boat.angle), sin = Math.sin(boat.angle);
  const lx = vx * cos + vy * sin, ly = -vx * sin + vy * cos;
  const n = Math.hypot(lx, ly) || 1;
  girl.dir = [lx / n, ly / n];
  girl.timer = 2.8;
}

function updateGirl(dts) {
  girl.timer = Math.max(0, girl.timer - dts);
  girl.w += ((girl.timer > 0 ? 1 : 0) - girl.w) * (1 - Math.exp(-dts / 0.25));
  const w = smooth(clamp(girl.w, 0, 1));
  const [dx, dy] = girl.dir;
  const hx = lerp(67.5, 72 + dx * 30, w), hy = lerp(230.5, 244 + dy * 30, w);
  const cx = lerp(77, 72 + dx * 15 - dy * 3, w), cy = lerp(236, 244 + dy * 15 + dx * 3, w);
  gArm.setAttribute("d", `M72,244 Q${cx.toFixed(2)},${cy.toFixed(2)} ${hx.toFixed(2)},${hy.toFixed(2)}`);
  gHand.setAttribute("cx", hx.toFixed(2));
  gHand.setAttribute("cy", hy.toFixed(2));
  const lx = lerp(64.5, hx + dx * 3.5, w), ly = lerp(226.5, hy + dy * 3.5, w);
  gLotus.setAttribute("transform", `translate(${lx.toFixed(2)} ${ly.toFixed(2)})`);
}

/* ---------- tap the girl: she stands up in the "Titanic" pose ---------- */
const girlLie = document.getElementById("girl");
const girlStand = document.getElementById("girlStand");
const gsArmL = document.getElementById("gsArmL");
const gsArmR = document.getElementById("gsArmR");
const bannerEl = document.getElementById("banner");
const bannerPaper = document.getElementById("bannerPaper");
const act = { t: -1, kind: "titanic" };   // t = -1 means she is lying down
const ACT_LEN = 7.6, BANNER_LEN = 9.4;
let banW = 0;                              // how far the boatman's hands are on the paper

function startStand() {
  if (act.t >= 0) return;
  act.t = 0;
  act.kind = "titanic";
  girl.timer = 0;
}

function startBanner() {
  if (act.t >= 0) return;
  act.t = 0;
  act.kind = "banner";
  girl.timer = 0;
  waveT = 0;
}

function updateStand(dts) {
  if (act.t < 0) return;
  act.t += dts;
  const t = act.t;
  const banner = act.kind === "banner";
  if (t > (banner ? BANNER_LEN : ACT_LEN)) {
    act.t = -1;
    banW = 0;
    girlLie.style.opacity = 1;
    girlStand.style.opacity = 0;
    bannerEl.style.opacity = 0;
    girlStand.classList.remove("on");
    bannerEl.classList.remove("on");
    return;
  }
  let up, arms, ang;
  if (banner) {
    up = smooth(clamp(t / 0.9, 0, 1)) * (1 - smooth(clamp((t - 8.4) / 0.9, 0, 1)));
    arms = smooth(clamp((t - 0.3) / 0.7, 0, 1)) * (1 - smooth(clamp((t - 7.9) / 0.6, 0, 1)));
    banW = arms;
    ang = lerp(80, -46, arms); // her hands reach up to the bottom edge of the paper
    // the paper unrolls between them, then rolls back up
    const open = smooth(clamp((t - 1) / 0.7, 0, 1)) * (1 - smooth(clamp((t - 7.4) / 0.6, 0, 1)));
    bannerEl.style.opacity = Math.min(1, open * 1.5).toFixed(3);
    bannerEl.classList.toggle("on", open > 0.01);
    const sway = Math.sin(t * 1.6) * 1.2 * open;
    bannerPaper.setAttribute("transform",
      `rotate(${sway.toFixed(2)} 60 170) translate(60 170) scale(${(0.96 + 0.04 * open).toFixed(3)} ${(0.05 + 0.95 * open).toFixed(3)}) translate(-60 -170)`);
  } else {
    up = smooth(clamp(t / 0.9, 0, 1)) * (1 - smooth(clamp((t - 6.6) / 0.9, 0, 1)));
    arms = smooth(clamp((t - 0.9) / 0.9, 0, 1)) * (1 - smooth(clamp((t - 5.7) / 0.8, 0, 1)));
    ang = lerp(80, -6, arms) + Math.sin(t * 2.2) * 2.5 * arms;
  }
  girlLie.style.opacity = (1 - up).toFixed(3);
  girlStand.style.opacity = up.toFixed(3);
  girlStand.classList.toggle("on", up > 0.01);
  // she rises toward us, so she looks a little bigger standing
  girlStand.setAttribute("transform", `translate(60 236) scale(${(0.85 + 0.4 * up).toFixed(3)}) translate(-60 -236)`);
  gsArmL.setAttribute("transform", `rotate(${(-ang).toFixed(2)} 49 234)`);
  gsArmR.setAttribute("transform", `rotate(${ang.toFixed(2)} 71 234)`);
}

/* ---------- tap the boat: the girl, or the boatman? ---------- */
function boatLocal(x, y) {
  const s = (boatSize / 320) * boat.scale;
  const dx = x - boat.x, dy = y - (boat.y + boat.bob);
  const cos = Math.cos(boat.angle), sin = Math.sin(boat.angle);
  return [(dx * cos + dy * sin) / s + 60, (-dx * sin + dy * cos) / s + 150];
}
// one tap: the boatman waves, or the girl does the Titanic pose
// two quick taps: they hold up the paper message together
let tapTimer = null;
function tapBoat(x, y) {
  const [lx, ly] = boatLocal(x, y);
  const onGirl = lx > 28 && lx < 92 && ly > 186 && ly < 286;
  const onBoat = lx > 8 && lx < 112 && ly > -2 && ly < 294;
  if (!onGirl && !onBoat) return false;
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = null;
    startBanner();
    return true;
  }
  tapTimer = setTimeout(() => {
    tapTimer = null;
    if (onGirl) startStand();
    else if (act.t < 0) waveT = 3;
  }, 300);
  return true;
}

// a heart-shaped ripple
function heartPath(c, x, y, r) {
  const k = r / 16;
  c.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
    const hx = 16 * Math.pow(Math.sin(a), 3);
    const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    if (a === 0) c.moveTo(x + hx * k, y + hy * k); else c.lineTo(x + hx * k, y + hy * k);
  }
  c.closePath();
}

/* =========================================================
   New animals: fox, rabbit, arctic fox (with tracks)
   ========================================================= */
const prints = [];
let groundScroll = 0;

function drawPrints(dts) {
  for (let i = prints.length - 1; i >= 0; i--) {
    const p = prints[i];
    p.age += dts;
    const y = p.wy + groundScroll;
    if (p.age > 40 || y > H + 20) { prints.splice(i, 1); continue; }
    if (y < -20) continue;
    wctx.fillStyle = `rgba(28,40,60,${(0.65 * (1 - p.age / 40)).toFixed(3)})`;
    wctx.beginPath(); wctx.ellipse(p.x, y, 2.2 * p.s, 1.5 * p.s, p.a, 0, Math.PI * 2); wctx.fill();
  }
}

function drawFox(c, d, x, y, ang) {
  const arctic = d.kind === "arctic";
  const g = Math.sin(d.phase), g2 = Math.sin(d.phase + Math.PI);
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(d.size, d.size);
  c.fillStyle = "rgba(0,0,0,.35)";
  c.beginPath(); c.ellipse(3, 5, 6, 16, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = arctic ? "#8a96a6" : "#2a1408";
  c.lineWidth = 1.4;
  c.lineCap = "round";
  const leg = (hx, hy, tx, ty) => { c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke(); };
  leg(-2.4, -5, -3, -8 - 4 * g);
  leg(2.4, -5, 3, -8 - 4 * g2);
  leg(-2.4, 6, -3, 9 + 4 * g2);
  leg(2.4, 6, 3, 9 + 4 * g);
  const sw = Math.sin(d.phase * 0.5) * 2;
  c.fillStyle = arctic ? "#dfe7f0" : "#b8561f";
  c.beginPath(); c.ellipse(sw * 0.5, 15, 3.2, 7, sw * 0.05, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#f4f4f0";
  c.beginPath(); c.ellipse(sw, 20.5, 2, 2.6, 0, 0, Math.PI * 2); c.fill();
  const body = c.createLinearGradient(-4.5, 0, 4.5, 0);
  body.addColorStop(0, arctic ? "#9aa8b8" : "#7a3a14");
  body.addColorStop(0.5, arctic ? "#f2f6fa" : "#e0843e");
  body.addColorStop(1, arctic ? "#9aa8b8" : "#7a3a14");
  c.fillStyle = body;
  c.beginPath(); c.ellipse(0, 0, 4.4, 9.5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = arctic ? "#eef3f8" : "#d2763a";
  c.beginPath(); c.moveTo(-3.6, -9); c.quadraticCurveTo(-3.4, -14, 0, -18); c.quadraticCurveTo(3.4, -14, 3.6, -9); c.closePath(); c.fill();
  c.fillStyle = arctic ? "#c8d2de" : "#5a2a10";
  c.beginPath(); c.moveTo(-3.4, -10.5); c.lineTo(-4.6, -14); c.lineTo(-1.6, -12); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(3.4, -10.5); c.lineTo(4.6, -14); c.lineTo(1.6, -12); c.closePath(); c.fill();
  c.fillStyle = "#111";
  c.beginPath(); c.arc(0, -17.6, 0.9, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawRabbit(c, d, x, y, ang) {
  const hop = Math.max(0, Math.sin(d.phase));
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(d.size, d.size);
  c.fillStyle = "rgba(0,0,0,.35)";
  c.beginPath(); c.ellipse(2 + hop * 2, 3 + hop * 3, 4.5, 7, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#8a7a68";
  c.beginPath(); c.ellipse(0, 0, 4.2, 5.8 + hop * 1.6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#9a8a76";
  c.beginPath(); c.ellipse(0, -6.5 - hop, 3, 3.4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#7a6a58";
  c.beginPath(); c.ellipse(-1.3, -11 - hop, 0.9, 3.4, -0.15, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(1.3, -11 - hop, 0.9, 3.4, 0.15, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#f2efe8";
  c.beginPath(); c.arc(0, 6 + hop * 0.5, 1.8, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#111";
  c.beginPath(); c.arc(-1.6, -7.5 - hop, 0.5, 0, Math.PI * 2); c.arc(1.6, -7.5 - hop, 0.5, 0, Math.PI * 2); c.fill();
  c.restore();
}

/* =========================================================
   Things baked into the riverbanks + their animation
   (glowing mushrooms, waterfalls, desert camp and ruins)
   ========================================================= */
function drawMushrooms(c, x, y) {
  const n = 3 + ((R() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const mx = x + rand(-6, 6) * S, my = y + rand(-6, 6) * S, r = rand(1.4, 2.8) * S;
    c.fillStyle = "rgba(120,255,215,.25)";
    c.beginPath(); c.arc(mx, my, r * 2.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#9ff7e0";
    c.beginPath(); c.arc(mx, my, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,.7)";
    c.beginPath(); c.arc(mx - r * 0.3, my - r * 0.3, r * 0.35, 0, Math.PI * 2); c.fill();
  }
}

function fallsCurve(c, x0, y0, x1, y1) {
  c.beginPath();
  c.moveTo(x0, y0);
  c.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 18, x1, y1);
}

function drawFallsBase(c, x0, y0, x1, y1) {
  // a rocky gorge with the stream running down into the river
  for (const [col, w] of [["#15181c", 40], ["#2a2f36", 28], ["rgba(150,182,212,.9)", 17], ["rgba(232,242,255,.7)", 7]]) {
    c.strokeStyle = col;
    c.lineWidth = w * S;
    fallsCurve(c, x0, y0, x1, y1);
    c.stroke();
  }
  // the cliff edge where it pours over
  c.fillStyle = "#1c2026";
  c.beginPath(); c.ellipse(x0, y0, 20 * S, 12 * S, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(220,235,250,.7)";
  c.beginPath(); c.ellipse(x0, y0, 7 * S, 5 * S, 0, 0, Math.PI * 2); c.fill();
  // foam pool where it meets the river
  c.fillStyle = "rgba(225,238,252,.55)";
  c.beginPath(); c.arc(x1, y1, 18 * S, 0, Math.PI * 2); c.fill();
}

function drawFalls(f, sy, t, dts) {
  const x0 = f.x0, y0 = sy + f.dy0, x1 = f.x1, y1 = sy;
  wctx.save();
  wctx.globalAlpha = FA;
  wctx.lineCap = "round";
  wctx.setLineDash([6, 9]);
  wctx.lineDashOffset = -t * 0.06;
  wctx.strokeStyle = "rgba(240,248,255,.8)";
  wctx.lineWidth = 4 * S;
  fallsCurve(wctx, x0, y0, x1, y1);
  wctx.stroke();
  wctx.setLineDash([3, 12]);
  wctx.lineDashOffset = -t * 0.09;
  wctx.strokeStyle = "rgba(255,255,255,.5)";
  wctx.lineWidth = 1.5 * S;
  fallsCurve(wctx, x0 + 2.5, y0, x1 + 2.5, y1);
  wctx.stroke();
  wctx.restore();
  // mist rising from the bottom of the falls
  for (let k = 0; k < 4; k++) {
    const r = (32 + 12 * Math.sin(t * 0.0015 + k * 1.6)) * S;
    wctx.globalAlpha = 0.6 * FA;
    wctx.drawImage(fogSprite.cv, x1 - r + Math.sin(t * 0.0007 + k) * 8, y1 - r + Math.cos(t * 0.0009 + k * 2) * 6, r * 2, r * 2);
  }
  wctx.globalAlpha = 1;
  f.rt = (f.rt || 0) + dts;
  if (f.rt > 0.6 && FA > 0.5) { f.rt = 0; rings.push({ x: x1, y: y1, r: 4, a: 0.3, max: 0.3, life: 2.4 }); }
}

function drawTent(c, x, y, w, h, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = "rgba(0,0,0,.45)";
  c.fillRect(-w / 2 + w * 0.1, -h / 2 + h * 0.15, w, h);
  // rug in front of the tent
  c.fillStyle = "#7a2a24";
  c.fillRect(-w * 0.3, h * 0.5, w * 0.6, h * 0.45);
  c.strokeStyle = "rgba(230,180,90,.6)";
  c.lineWidth = 1;
  c.strokeRect(-w * 0.3 + 1.5, h * 0.5 + 1.5, w * 0.6 - 3, h * 0.45 - 3);
  // guy ropes
  c.strokeStyle = "rgba(200,180,140,.5)";
  c.lineWidth = 0.7;
  for (const [ax, ay, bx, by] of [[-w / 2, -h / 2, -w * 0.75, -h * 0.85], [w / 2, -h / 2, w * 0.75, -h * 0.85], [-w / 2, h / 2, -w * 0.75, h * 0.8], [w / 2, h / 2, w * 0.75, h * 0.8]]) {
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
  }
  // black goat-hair cloth with woven stripes
  c.fillStyle = "#2a221c";
  c.fillRect(-w / 2, -h / 2, w, h);
  c.strokeStyle = "rgba(200,170,120,.22)";
  c.lineWidth = 1.5;
  for (let k = 1; k < 6; k++) {
    const px = -w / 2 + (w * k) / 6;
    c.beginPath(); c.moveTo(px, -h / 2); c.lineTo(px, h / 2); c.stroke();
  }
  c.fillStyle = "rgba(255,230,180,.25)";
  for (let k = 1; k < 4; k++) {
    c.beginPath(); c.arc(-w / 2 + (w * k) / 4, 0, 1.6, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

function drawFirePit(c, x, y) {
  c.fillStyle = "#1a120c";
  c.beginPath(); c.arc(x, y, 6 * S, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#6a625a";
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    c.beginPath(); c.arc(x + Math.cos(a) * 7 * S, y + Math.sin(a) * 7 * S, 1.8 * S, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = "#4a3020";
  c.lineWidth = 2 * S;
  c.beginPath(); c.moveTo(x - 5 * S, y - 3 * S); c.lineTo(x + 5 * S, y + 3 * S); c.moveTo(x - 5 * S, y + 3 * S); c.lineTo(x + 5 * S, y - 3 * S); c.stroke();
}

function drawFire(x, y, t) {
  wctx.save();
  wctx.globalCompositeOperation = "lighter";
  wctx.globalAlpha = (0.75 + 0.25 * Math.sin(t * 0.017) * Math.sin(t * 0.011 + 1)) * FA;
  wctx.drawImage(fireGlow.cv, x - fireGlow.size / 2, y - fireGlow.size / 2, fireGlow.size, fireGlow.size);
  wctx.globalAlpha = FA;
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + Math.sin(t * 0.01 + k) * 0.3;
    const r = (3 + 2.2 * Math.abs(Math.sin(t * 0.013 + k * 1.7))) * S;
    wctx.fillStyle = k % 2 ? "rgba(255,150,40,.8)" : "rgba(255,210,90,.8)";
    wctx.beginPath(); wctx.ellipse(x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5, r * 0.55, r, a, 0, Math.PI * 2); wctx.fill();
  }
  wctx.fillStyle = "#ffcf70";
  for (let k = 0; k < 7; k++) {
    const ph = (t * 0.0006 + k / 7) % 1;
    wctx.globalAlpha = (1 - ph) * FA;
    wctx.beginPath();
    wctx.arc(x + Math.cos(k * 2.3) * ph * 16 * S, y + Math.sin(k * 1.7) * ph * 16 * S - ph * 6, 1, 0, Math.PI * 2);
    wctx.fill();
  }
  wctx.restore();
}

function drawRuins(c, x, y, rot) {
  const s = S;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = "rgba(150,120,85,.3)";
  c.fillRect(-60 * s, -40 * s, 120 * s, 80 * s);
  // broken walls
  const walls = (ox, oy, col, w) => {
    c.strokeStyle = col;
    c.lineWidth = w * s;
    c.beginPath();
    c.moveTo((-60 + ox) * s, (-40 + oy) * s); c.lineTo((-12 + ox) * s, (-40 + oy) * s);
    c.moveTo((14 + ox) * s, (-40 + oy) * s); c.lineTo((60 + ox) * s, (-40 + oy) * s); c.lineTo((60 + ox) * s, (2 + oy) * s);
    c.moveTo((60 + ox) * s, (22 + oy) * s); c.lineTo((60 + ox) * s, (40 + oy) * s); c.lineTo((22 + ox) * s, (40 + oy) * s);
    c.moveTo((-26 + ox) * s, (40 + oy) * s); c.lineTo((-60 + ox) * s, (40 + oy) * s); c.lineTo((-60 + ox) * s, (-6 + oy) * s);
    c.stroke();
  };
  walls(3, 4, "rgba(0,0,0,.45)", 7);
  walls(0, 0, "#7d6648", 6);
  walls(-0.8, -0.8, "rgba(220,190,140,.35)", 2);
  // columns, some broken
  for (let i = -2; i <= 2; i++) {
    for (const j of [-18, 18]) {
      const cx = i * 22 * s, cy = j * s;
      if (R() < 0.25) {
        c.fillStyle = "#6a5640";
        c.beginPath(); c.arc(cx, cy, 3 * s, 0, Math.PI * 2); c.fill();
        continue;
      }
      c.fillStyle = "rgba(0,0,0,.45)";
      c.beginPath(); c.arc(cx + 3 * s, cy + 4 * s, 4.8 * s, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(cx - 1.5 * s, cy - 1.5 * s, 0, cx, cy, 4.8 * s);
      g.addColorStop(0, "#c9ad80");
      g.addColorStop(1, "#6a5438");
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, cy, 4.8 * s, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(60,40,20,.4)";
      c.lineWidth = 0.6;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * 2.5 * s, cy + Math.sin(a) * 2.5 * s); c.lineTo(cx + Math.cos(a) * 4.6 * s, cy + Math.sin(a) * 4.6 * s); c.stroke();
      }
    }
  }
  // a fallen column
  c.save();
  c.rotate(0.5);
  c.fillStyle = "rgba(0,0,0,.4)";
  c.fillRect(-18 * s, 26 * s, 34 * s, 9 * s);
  c.fillStyle = "#a88c64";
  c.fillRect(-20 * s, 22 * s, 34 * s, 8 * s);
  c.strokeStyle = "rgba(60,40,20,.4)";
  c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(-8 * s, 22 * s); c.lineTo(-8 * s, 30 * s); c.moveTo(4 * s, 22 * s); c.lineTo(4 * s, 30 * s); c.stroke();
  c.restore();
  // scattered blocks
  c.fillStyle = "#8a7252";
  for (let k = 0; k < 7; k++) {
    c.save();
    c.translate(rand(-70, 70) * s, rand(-50, 50) * s);
    c.rotate(rand(0, 3));
    c.fillRect(-3 * s, -2 * s, 6 * s, 4 * s);
    c.restore();
  }
  c.restore();
}

let FA = 1; // how visible the place a feature belongs to is, at that spot (0..1)

function featureRegions() {
  if (!trans) return [[tiles.cur, () => 1]];
  const top = trans.by - SEAM;
  return [
    [tiles.cur, (sy) => clamp((sy - top) / 60, 0, 1)],
    [tiles.next, (sy) => clamp(1 - (sy - top) / SEAM, 0, 1)],
  ];
}

function drawFeatures(t, dts) {
  for (const [tile, vis] of featureRegions()) {
    if (!tile) continue;
    for (const f of tile.features) {
      const s1 = mod(f.y + bankOff, TILE);
      for (const sy of [s1, s1 - TILE]) {
        if (sy < -200 || sy > H + 200) continue;
        FA = vis(sy);
        if (FA < 0.01) continue;
        if (f.type === "glow") {
          wctx.save();
          wctx.globalCompositeOperation = "lighter";
          wctx.globalAlpha = (0.55 + 0.35 * Math.sin(t * 0.0012 + f.ph)) * (1 - dawn * 0.7) * FA;
          wctx.drawImage(tealGlow.cv, f.x - f.r, sy - f.r, f.r * 2, f.r * 2);
          wctx.restore();
        } else if (f.type === "fire") {
          drawFire(f.x, sy, t);
        } else if (f.type === "falls") {
          drawFalls(f, sy, t, dts);
        }
      }
    }
  }
}

/* =========================================================
   Fireflies + falling snow (top canvas)
   ========================================================= */
function buildFireflies() {
  flies = Array.from({ length: SMALL ? 18 : 30 }, () => ({
    x: Math.random(), y: Math.random(), ax: rand(20, 70), ay: rand(15, 50),
    sx: rand(0.0002, 0.0006), sy: rand(0.0003, 0.0008),
    ph: rand(0, Math.PI * 2), bph: rand(0, Math.PI * 2), bs: rand(0.001, 0.003),
  }));
  flakes = Array.from({ length: SMALL ? 80 : 150 }, () => ({
    x: rand(0, W), y: rand(0, H), r: rand(0.7, 2.3),
    vx: rand(-8, 8), vy: rand(10, 26), ph: rand(0, Math.PI * 2),
  }));
}

function drawFX(t, dts, env) {
  fctx.clearRect(0, 0, W, H);
  const ff = envNum(env, "fireflies") * (1 - dawn) * (1 - weather.rain * 0.8);
  if (ff > 0.01) {
    for (const f of flies) {
      const glow = Math.max(0, Math.sin(t * f.bs + f.bph)) * ff;
      if (glow < 0.02) continue;
      const x = f.x * W + Math.sin(t * f.sx + f.ph) * f.ax;
      const y = f.y * H + Math.cos(t * f.sy + f.ph) * f.ay;
      fctx.globalAlpha = glow * 0.22;
      fctx.fillStyle = "#c8ff7a";
      fctx.beginPath(); fctx.arc(x, y, 7, 0, Math.PI * 2); fctx.fill();
      fctx.globalAlpha = glow;
      fctx.fillStyle = "#f0ffc0";
      fctx.beginPath(); fctx.arc(x, y, 1.6, 0, Math.PI * 2); fctx.fill();
    }
  }
  const snow = envNum(env, "snow");
  if (snow > 0.01) {
    fctx.fillStyle = "#eef4ff";
    for (const f of flakes) {
      f.x += (f.vx + Math.sin(t * 0.001 + f.ph) * 10) * dts;
      f.y += (f.vy + bankSpeed * 0.3) * dts;
      if (f.y > H + 5) { f.y = -5; f.x = rand(0, W); }
      if (f.x < -5) f.x = W + 5;
      if (f.x > W + 5) f.x = -5;
      fctx.globalAlpha = snow * 0.85 * (0.6 + 0.4 * Math.sin(t * 0.002 + f.ph));
      fctx.beginPath(); fctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); fctx.fill();
    }
  }
  fctx.globalAlpha = 1;
  const au = envNum(env, "aurora") * (1 - dawn);
  if (au > 0.01) {
    fctx.fillStyle = `rgba(70,255,170,${(0.035 * au).toFixed(3)})`;
    fctx.fillRect(0, 0, W, H);
  }
  drawVisitors(t, dts, ff);
  drawWeatherFX(t, dts);
  drawBirds(dts);
  drawSparkles(dts);
}

/* ---------- lantern flicker ---------- */
let flick = 1, flickT = 1;
function updateFlicker(dt) {
  if (Math.random() < 0.08) flickT = rand(0.7, 1);
  flick += (flickT - flick) * (1 - Math.exp(-dt / 60));
  const lamp = 1 - 0.7 * dawn;
  rootStyle.setProperty("--flick", (flick * lamp).toFixed(3));
  rootStyle.setProperty("--lamp", lamp.toFixed(3));
}

/* ---------- boat movement ---------- */
function updateBoat(t, dt) {
  const ty = mod(boat.y - bankOff, TILE);
  const cxNow = riverCenter(ty), cxAhead = riverCenter(ty - 70);
  const targetX = cxNow + Math.sin(t * 0.00035) * riverW * 0.04;
  boat.x += (targetX - boat.x) * (1 - Math.exp(-dt / 600));
  const targetA = Math.atan2(cxAhead - cxNow, 70) * 0.5;
  boat.heading = (boat.heading ?? targetA) + (targetA - (boat.heading ?? targetA)) * (1 - Math.exp(-dt / 900));
  boat.angle = boat.heading + 0.02 * Math.sin(t * 0.0011) + 0.008 * Math.sin(t * 0.0027);
  boat.bob = Math.sin(t * 0.0013) * 2.5;
  boat.scale = 1 + 0.008 * Math.sin(t * 0.0016);
  boatEl.style.transform =
    `translate(${boat.x - boatSize / 2}px, ${boat.y + boat.bob - boatSize / 2}px) ` +
    `rotate(${boat.angle}rad) scale(${boat.scale})`;
}

// soft shadow of the hull on the water, and the lantern's warm light around the boat
let boatShadow = null, lampGlow = null;
const HULL = new Path2D("M60,2 C92,36 107,100 107,170 C107,232 100,268 93,290 L27,290 C20,268 13,232 13,170 C13,100 28,36 60,2 Z");
function buildBoatSprites() {
  const k = boatSize / 320;
  boatShadow = makeSprite(boatSize, (c) => {
    c.scale(k, k);
    c.translate(-60, -150);
    c.lineJoin = "round";
    for (const [w, a] of [[26, 0.05], [18, 0.07], [11, 0.09], [5, 0.12]]) {
      c.strokeStyle = `rgba(0,0,0,${a})`;
      c.lineWidth = w;
      c.stroke(HULL);
    }
    c.fillStyle = "rgba(0,0,0,.45)";
    c.fill(HULL);
  });
  const Rl = boatSize * 1.1;
  lampGlow = makeSprite(Rl * 2, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, Rl);
    g.addColorStop(0, "rgba(255,185,95,.34)");
    g.addColorStop(0.3, "rgba(255,140,55,.12)");
    g.addColorStop(0.65, "rgba(255,140,55,0)");
    c.fillStyle = g;
    c.fillRect(-Rl, -Rl, Rl * 2, Rl * 2);
  });
}
function drawBoatShadowAndGlow() {
  wctx.save();
  wctx.translate(boat.x, boat.y + boat.bob + 8);
  wctx.rotate(boat.angle);
  wctx.scale(boat.scale, boat.scale);
  wctx.drawImage(boatShadow.cv, -boatShadow.size / 2, -boatShadow.size / 2, boatShadow.size, boatShadow.size);
  wctx.restore();
  const [lx, ly] = boatPoint(81, 268);
  wctx.save();
  wctx.globalCompositeOperation = "lighter";
  wctx.globalAlpha = (0.7 + 0.3 * flick) * (1 - 0.7 * dawn) * 0.85;
  wctx.drawImage(lampGlow.cv, lx - lampGlow.size / 2, ly - lampGlow.size / 2, lampGlow.size, lampGlow.size);
  wctx.restore();
}

/* =========================================================
   Setup / resize
   ========================================================= */
function setup() {
  const vw = window.innerWidth, vh = window.innerHeight;
  vwLast = vw; vhLast = vh;
  SMALL = vw <= 600 || vh <= 500;
  const portrait = vh > vw;
  ZOOM = SMALL ? 1.05 : 1;
  W = vw / ZOOM;
  H = vh / ZOOM;
  scene.style.width = `${W}px`;
  scene.style.height = `${H}px`;
  scene.style.transform = ZOOM === 1 ? "none" : `scale(${ZOOM})`;

  // phones draw at a lower (still sharp) resolution — far fewer pixels each frame
  DPR = Math.min((window.devicePixelRatio || 1) * ZOOM, SMALL ? 1.5 : 2);
  FXDPR = Math.min(DPR, SMALL ? 1.25 : 1.5);
  TD = SMALL ? DPR : Math.min(DPR, 1.5);
  S = SMALL ? 0.85 : 1;
  LITE = SMALL; // phones run at a steady 30 frames a second
  sizeCanvases();

  riverW = SMALL && portrait ? W * 0.64 : Math.min(W * (SMALL ? 0.54 : 0.5), 760);
  TILE = Math.max(2000, Math.ceil(H) + 400);

  sizeBoat(portrait);
  bankOff = mod(bankOff, TILE);
  boat.x = riverCenter(mod(boat.y - bankOff, TILE));
  boat.heading = undefined;
  rings.length = vwake.length = lilies.length = animals.length = fishes.length = drops.length = 0;

  buildGeom();
  trans = null;
  bankSpeed = BASE_SPEED;
  tiles.cur = buildPlace(placeIdx);
  tiles.next = null;
  scheduleNextBuild();
  buildWater();
  buildFireflies();
  buildWeatherFX();
  buildSprites();
  buildBoatSprites();
  shooters.length = sparkles.length = rainRings.length = flocks.length = visitors.length = prints.length = 0;
}

function sizeCanvases() {
  world.width = Math.round(W * DPR);
  world.height = Math.round(H * DPR);
  fx.width = Math.round(W * FXDPR);
  fx.height = Math.round(H * FXDPR);
  wctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fctx.setTransform(FXDPR, 0, 0, FXDPR, 0, 0);
}

function sizeBoat(portrait) {
  boatSize = Math.min(H * (SMALL && !portrait ? 0.64 : 0.5), 420, Math.max(riverW, W * 0.8));
  boatEl.style.width = boatEl.style.height = `${boatSize}px`;
  boat.y = H * 0.6;
}

// the phone's address bar sliding in/out only changes the height:
// resize the canvases and keep all the scenery that is already drawn
function lightResize(vw, vh) {
  vwLast = vw; vhLast = vh;
  H = vh / ZOOM;
  if (H + 400 > TILE || (vw <= 600 || vh <= 500) !== SMALL) { setup(); return; }
  scene.style.height = `${H}px`;
  sizeCanvases();
  sizeBoat(vh > vw);
  buildBoatSprites();
}

let resizeTimer = null;
function requestSetup() {
  if (resizeTimer) return;
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw === vwLast && W) lightResize(vw, vh);
    else setup();
  }, 200);
}
window.addEventListener("resize", requestSetup);
window.addEventListener("orientationchange", () => setTimeout(requestSetup, 300));

/* ---------- phone helpers: fullscreen, landscape, fold-away player ---------- */
const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
if (fsSupported) document.body.classList.add("fs-ok");

async function goFullscreen() {
  const el = document.documentElement;
  try {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
      await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen());
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
  } catch (e) { /* not supported on this phone — the user can rotate by hand */ }
}
function exitFullscreen() {
  try {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (e) {}
}
document.getElementById("fullBtn").addEventListener("click", goFullscreen);
document.getElementById("fsBtn").addEventListener("click", () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen();
  else goFullscreen();
});
document.getElementById("skipBtn").addEventListener("click", () => {
  document.body.classList.add("portrait-ok");
});
document.getElementById("collapseBtn").addEventListener("click", () => {
  document.getElementById("player").classList.toggle("collapsed");
});

/* ---------- main loop ---------- */
let last = performance.now(), slowFrames = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const raw = t - last;
  if (LITE && raw < 30) return; // skip every other screen refresh
  const dt = Math.min(raw, 100);
  const dts = dt / 1000;
  last = t;
  if (!LITE) {
    slowFrames = raw > 26 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 90) LITE = true;
  }

  // keep the scene matched to the real screen size (phone bars, rotation)
  if (window.innerWidth !== vwLast || window.innerHeight !== vhLast) requestSetup();

  updateTravel(dts);
  updateSky(dts);
  updateWeather(dts);
  bankOff = mod(bankOff + bankSpeed * dts, TILE);
  groundScroll += bankSpeed * dts;
  waterSpeed = bankSpeed * WATER_FACTOR;
  waterOff = mod(waterOff + waterSpeed * dts, TILE);
  const env = envMix();

  drawWater(t, env);
  drawAurora(t, envNum(env, "aurora"));
  updateShooters(dts);
  drawRainRings(dts);
  emitWake(dts);
  drawWake(dts);
  drawLilies(t, dts);
  drawBanks();
  drawFeatures(t, dts);
  updateFish(dts);
  updateAnimals(dts);
  updateBoat(t, dt);
  drawBoatShadowAndGlow();
  updateRowing(dts);
  updateGirl(dts);
  updateStand(dts);
  updateFlicker(dt);
  drawFX(t, dts, env);
  rootStyle.setProperty("--mist", (envNum(env, "mist") + weather.fog * 1.2).toFixed(3));
  rootStyle.setProperty("--dawn", dawn.toFixed(3));
  dawnEl.style.visibility = dawn > 0.003 ? "visible" : "hidden";
}

setup();
requestAnimationFrame(loop);


/* =========================================================
   4) MUSIC PLAYER
   ========================================================= */
const audio     = document.getElementById("audio");
const player    = document.getElementById("player");
const playBtn   = document.getElementById("playBtn");
const playIcon  = document.getElementById("playIcon");
const prevBtn   = document.getElementById("prevBtn");
const nextBtn   = document.getElementById("nextBtn");
const muteBtn   = document.getElementById("muteBtn");
const volIcon   = document.getElementById("volIcon");
const progress  = document.getElementById("progress");
const volume    = document.getElementById("volume");
const trackName = document.getElementById("trackName");
const curEl     = document.getElementById("cur");
const durEl     = document.getElementById("dur");

const ICON_PLAY  = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
const ICON_PAUSE = '<path d="M6 5h4v14H6zm8 0h4v14h-4z" fill="currentColor"/>';
const ICON_VOL   = '<path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" fill="currentColor"/>';
const ICON_MUTE  = '<path d="M3 10v4h4l5 5V5L7 10H3z" fill="currentColor"/><path d="M15 9l6 6m0-6l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

let current = 0;
let seeking = false;

const fmt = (sec) => {
  if (!isFinite(sec)) return "0:00";
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, "0")}`;
};
const setFill = (input) => {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--p", `${p}%`);
};
const updateVolIcon = () => {
  volIcon.innerHTML = audio.muted || audio.volume === 0 ? ICON_MUTE : ICON_VOL;
};

function loadTrack(i, autoplay = false) {
  current = mod(i, PLAYLIST.length);
  const track = PLAYLIST[current];
  audio.src = track.src;
  trackName.textContent = track.title || track.src;
  progress.value = 0;
  setFill(progress);
  curEl.textContent = "0:00";
  durEl.textContent = "0:00";
  if (autoplay) audio.play().catch(() => {});
}

if (PLAYLIST.length < 2) player.classList.add("single");
audio.loop = PLAYLIST.length === 1;
audio.volume = parseFloat(volume.value);
setFill(volume);
updateVolIcon();

audio.addEventListener("loadedmetadata", () => (durEl.textContent = fmt(audio.duration)));
audio.addEventListener("error", () => {
  trackName.textContent = `Song not found: ${PLAYLIST[current].src}`;
});
audio.addEventListener("play", () => {
  playIcon.innerHTML = ICON_PAUSE;
  playBtn.setAttribute("aria-label", "Pause");
  player.classList.add("playing");
});
audio.addEventListener("pause", () => {
  playIcon.innerHTML = ICON_PLAY;
  playBtn.setAttribute("aria-label", "Play");
  player.classList.remove("playing");
});
audio.addEventListener("ended", () => {
  if (PLAYLIST.length > 1) loadTrack(current + 1, true);
});
audio.addEventListener("timeupdate", () => {
  if (seeking) return;
  progress.value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  setFill(progress);
  curEl.textContent = fmt(audio.currentTime);
});

playBtn.addEventListener("click", () => {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
prevBtn.addEventListener("click", () => {
  const wasPlaying = !audio.paused;
  if (audio.currentTime > 3) audio.currentTime = 0;
  else loadTrack(current - 1, wasPlaying);
});
nextBtn.addEventListener("click", () => loadTrack(current + 1, !audio.paused));

progress.addEventListener("input", () => {
  seeking = true;
  setFill(progress);
  if (audio.duration) curEl.textContent = fmt((progress.value / 100) * audio.duration);
});
progress.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (progress.value / 100) * audio.duration;
  seeking = false;
});

volume.addEventListener("input", () => {
  audio.volume = parseFloat(volume.value);
  if (audio.volume > 0) audio.muted = false;
  setFill(volume);
  updateVolIcon();
});
muteBtn.addEventListener("click", () => {
  audio.muted = !audio.muted;
  updateVolIcon();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    playBtn.click();
  }
});

loadTrack(0);
