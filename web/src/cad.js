// JS port of backend/cad.py — render dispatcher.
// Routes every bucket through the fractional-bin SCAD path: body/lip/cavity
// render at the exact body footprint, while the Gridfinity foot grid is placed
// at the user's base-cell location inside that footprint.

import { renderStl } from "./openscad.js";

const STANDARD_SCAD = "scad/standard.scad";
const BASEPLATE_SCAD = "scad/baseplate.scad";

// ── Render cache ───────────────────────────────────────────────────────────
// openscad-wasm CGAL is slow (5–15 s for a typical bin). Three lookup tiers
// before falling back to WASM:
//   1. in-memory Map (same-session repeats)
//   2. localStorage (persists across reloads)
//   3. shipped cache/{scad-stem}/{hash}.stl (precomputed by the Python
//      backend at build time — instant for common configs)
const _mem = new Map();
const MEM_LIMIT = 32;
const LS_LIMIT = 1024 * 1024 * 12; // 12 MB localStorage budget
const LS_PREFIX = "stl-cache:";
const CACHE_DIR = "cache";

async function cacheKey(scadPath, params) {
  const keys = Object.keys(params).sort();
  const sig = `${scadPath}::` + keys.map((k) => `${k}=${formatParam(params[k])}`).join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sig));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stable string formatting for cache keys. Floats are rounded to 6 decimals
// so cosmetic differences (42 vs 42.0) don't bust the cache.
function formatParam(v) {
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : Number(v.toFixed(6)).toString();
  }
  if (Array.isArray(v)) return "[" + v.map(formatParam).join(",") + "]";
  return JSON.stringify(v);
}

function lsRead(key) {
  try {
    const b64 = localStorage.getItem(LS_PREFIX + key);
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) { return null; }
}
function lsWrite(key, bytes) {
  try {
    if (bytes.length * 1.4 > LS_LIMIT) return;
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    localStorage.setItem(LS_PREFIX + key, btoa(bin));
  } catch (err) {
    // Quota exceeded — drop oldest stl-cache entries until it fits.
    if (err && err.name === "QuotaExceededError") {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX));
      keys.slice(0, Math.ceil(keys.length / 4)).forEach((k) => localStorage.removeItem(k));
      try { localStorage.setItem(LS_PREFIX + key, btoa(bin)); } catch (_) { /* give up */ }
    }
  }
}

async function tryShippedCache(scadPath, key) {
  const stem = scadPath.split("/").pop().replace(/\.scad$/, "");
  // Try gzipped first (precompute.py outputs .stl.gz). Fall back to plain
  // .stl for back-compat with cached fixtures rendered before gzip support.
  const base = new URL(`../${CACHE_DIR}/${stem}/${key}`, import.meta.url).href;
  for (const [suffix, gz] of [[".stl.gz", true], [".stl", false]]) {
    try {
      const res = await fetch(base + suffix, { cache: "force-cache" });
      if (!res.ok) continue;
      if (!gz) return new Uint8Array(await res.arrayBuffer());
      // DecompressionStream is supported in all current evergreen browsers.
      const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (_) { /* try next */ }
  }
  return null;
}

async function cachedRender(scadPath, params) {
  const key = await cacheKey(scadPath, params);

  const memHit = _mem.get(key);
  if (memHit) return memHit;

  const lsHit = lsRead(key);
  if (lsHit) { _mem.set(key, lsHit); return lsHit; }

  const shipped = await tryShippedCache(scadPath, key);
  if (shipped) {
    _mem.set(key, shipped);
    lsWrite(key, shipped);
    return shipped;
  }

  const stl = await renderStl(scadPath, params);
  if (_mem.size >= MEM_LIMIT) _mem.delete(_mem.keys().next().value);
  _mem.set(key, stl);
  lsWrite(key, stl);
  return stl;
}

export function clearRenderCache() {
  _mem.clear();
  Object.keys(localStorage)
    .filter((k) => k.startsWith(LS_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

// Exported for the precompute script: same key the browser will look up.
export { cacheKey };

export function renderGeometry(bucket, project) {
  const cell = project.grid.cell_mm;
  const body = bucket.body_mm;
  const base = bucket.base_cells;

  const baseX0 = base.x * cell;
  const baseY0 = base.y * cell;
  const baseX1 = (base.x + base.w) * cell;
  const baseY1 = (base.y + base.d) * cell;
  const bodyX0 = body.x;
  const bodyY0 = body.y;
  const bodyX1 = body.x + body.w;
  const bodyY1 = body.y + body.d;

  const footX0 = Math.floor(Math.min(baseX0, bodyX0) / cell) * cell;
  const footY0 = Math.floor(Math.min(baseY0, bodyY0) / cell) * cell;
  const footX1 = Math.ceil(Math.max(baseX1, bodyX1) / cell) * cell;
  const footY1 = Math.ceil(Math.max(baseY1, bodyY1) / cell) * cell;
  const footGridW = Math.max(1, Math.round((footX1 - footX0) / cell));
  const footGridD = Math.max(1, Math.round((footY1 - footY0) / cell));

  const seam = { x0: false, x1: false, y0: false, y1: false };
  const parent = bucket.parent_body_mm;
  if (parent) {
    const eps = 1e-3;
    seam.x0 = Math.abs(body.x - parent.x) > eps;
    seam.x1 = Math.abs((body.x + body.w) - (parent.x + parent.w)) > eps;
    seam.y0 = Math.abs(body.y - parent.y) > eps;
    seam.y1 = Math.abs((body.y + body.d) - (parent.y + parent.d)) > eps;
  }

  return {
    body_w: Number(body.w),
    body_d: Number(body.d),
    body_h: Number(bucket.height_mm),
    base_grid_w: Number(base.w),
    base_grid_d: Number(base.d),
    base_offset_x: Number(base.x * cell - body.x),
    base_offset_y: Number(base.y * cell - body.y),
    foot_grid_w: footGridW,
    foot_grid_d: footGridD,
    foot_offset_x: Number(footX0 - body.x),
    foot_offset_y: Number(footY0 - body.y),
    cell_mm: Number(cell),
    scoop: Number(bucket.scoop || 0),
    include_lip: bucket.include_lip !== false,
    magnet_holes: !!bucket.magnet_holes,
    screw_holes: !!bucket.screw_holes,
    only_corners: !!bucket.only_corners_holes,
    refined_holes: false,
    seam_x0: seam.x0,
    seam_x1: seam.x1,
    seam_y0: seam.y0,
    seam_y1: seam.y1,
  };
}

export async function generateBucketStl(bucket, project) {
  return cachedRender(STANDARD_SCAD, renderGeometry(bucket, project));
}

export async function generateBaseplateStl(
  project,
  { gridW, gridD, cutBox = null, stylePlate = 0, styleHole = 0, enableMagnet = false } = {},
) {
  const params = {
    gridx: gridW,
    gridy: gridD,
    cell_mm: project.grid.cell_mm,
    style_plate: stylePlate,
    style_hole: styleHole,
    enable_magnet: enableMagnet,
  };
  if (cutBox) {
    params.cut_x0 = cutBox[0];
    params.cut_y0 = cutBox[1];
    params.cut_x1 = cutBox[2];
    params.cut_y1 = cutBox[3];
  }
  return cachedRender(BASEPLATE_SCAD, params);
}
