// JS port of backend/cad.py — render dispatcher.
// Routes every bucket to the standard kennetek bin sized to the smallest
// cell-aligned bounding grid that contains body ∪ base, with a cut box
// trimming back to the body extent. Overflow + split + standard all flow
// through one path.

import { renderStl } from "./openscad.js";

const STANDARD_SCAD = "scad/standard.scad";
const BASEPLATE_SCAD = "scad/baseplate.scad";
const GRIDZ_DEFINE_EXTERNAL_MM = 3;

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

function effectiveGeometry(bucket) {
  if (bucket.cut_box_mm && bucket.parent_body_mm) {
    return {
      body: bucket.parent_body_mm,
      base: bucket.parent_base_cells || bucket.base_cells,
      cutBox: bucket.cut_box_mm,
    };
  }
  return { body: bucket.body_mm, base: bucket.base_cells, cutBox: null };
}

export function boundingGridAndCut(bucket, project) {
  const cell = project.grid.cell_mm;
  const { body, base, cutBox } = effectiveGeometry(bucket);

  const baseX0 = base.x * cell;
  const baseY0 = base.y * cell;
  const baseX1 = (base.x + base.w) * cell;
  const baseY1 = (base.y + base.d) * cell;
  const bodyX0 = body.x;
  const bodyY0 = body.y;
  const bodyX1 = body.x + body.w;
  const bodyY1 = body.y + body.d;

  const unionX0 = Math.min(baseX0, bodyX0);
  const unionY0 = Math.min(baseY0, bodyY0);
  const unionX1 = Math.max(baseX1, bodyX1);
  const unionY1 = Math.max(baseY1, bodyY1);

  const bgx0 = Math.floor(unionX0 / cell) * cell;
  const bgy0 = Math.floor(unionY0 / cell) * cell;
  const bgx1 = Math.ceil(unionX1 / cell) * cell;
  const bgy1 = Math.ceil(unionY1 / cell) * cell;
  const gridW = Math.round((bgx1 - bgx0) / cell);
  const gridD = Math.round((bgy1 - bgy0) / cell);

  let cut;
  if (!cutBox) {
    cut = [bodyX0 - bgx0, bodyY0 - bgy0, bodyX1 - bgx0, bodyY1 - bgy0];
  } else {
    cut = [
      bodyX0 + cutBox[0] - bgx0,
      bodyY0 + cutBox[1] - bgy0,
      bodyX0 + cutBox[2] - bgx0,
      bodyY0 + cutBox[3] - bgy0,
    ];
  }
  return { gridW, gridD, cut };
}

function standardParams(bucket, project, gridW, gridD, cut) {
  return {
    gridx: gridW,
    gridy: gridD,
    gridz: bucket.height_mm,
    gridz_define: GRIDZ_DEFINE_EXTERNAL_MM,
    enable_zsnap: false,
    include_lip: bucket.include_lip,
    magnet_holes: bucket.magnet_holes,
    screw_holes: bucket.screw_holes,
    only_corners: bucket.only_corners_holes,
    scoop: Number(bucket.scoop || 0),
    style_tab: Number(bucket.style_tab ?? 5),
    divx: 1,
    divy: 1,
    refined_holes: false,
    cell_mm: project.grid.cell_mm,
    cut_x0: cut[0],
    cut_y0: cut[1],
    cut_x1: cut[2],
    cut_y1: cut[3],
  };
}

export async function generateBucketStl(bucket, project) {
  const { gridW, gridD, cut } = boundingGridAndCut(bucket, project);
  return cachedRender(STANDARD_SCAD, standardParams(bucket, project, gridW, gridD, cut));
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
