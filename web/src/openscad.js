// Wraps openscad-wasm. Mounts the SCAD file tree (our wrappers + kennetek
// vendor) into the WASM filesystem at /scad and /vendor, then runs openscad
// CLI with -D parameter overrides and reads back the binary STL.

import OpenSCAD from "../vendor/openscad/openscad.js";

let _instance = null;
let _mounted = false;

// Files to fetch and mount into the WASM FS at startup. Paths are relative
// to web/ (the static site root).
//
// We mount them at the same paths inside the WASM FS so the include/use
// directives in our SCAD files resolve cleanly via "../vendor/...".
const SCAD_FILES = [
  "scad/standard.scad",
  "scad/baseplate.scad",
  "scad/overflow.scad",
  // Top-level kennetek bins/baseplate (used by our wrappers)
  "vendor/gridfinity-rebuilt-openscad/gridfinity-rebuilt-baseplate.scad",
  // Core
  "vendor/gridfinity-rebuilt-openscad/src/core/standard.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/base.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/bin.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/cutouts.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-baseplate.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-holes.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-utility.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/tab.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/wall.scad",
  // Helpers
  "vendor/gridfinity-rebuilt-openscad/src/helpers/angles.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/dictionary.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/generic-helpers.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/grid.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/grid_element.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/list.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/shapes.scad",
  // External dependencies referenced by base.scad
  "vendor/gridfinity-rebuilt-openscad/src/external/threads-scad/threads.scad",
];

function siteRoot() {
  // Resolve site root from this module's location (web/src/openscad.js → web/).
  return new URL("../", import.meta.url);
}

async function ensureInstance() {
  if (_instance) return _instance;
  _instance = await OpenSCAD({ noInitialRun: true });
  return _instance;
}

async function ensureMounted(instance) {
  if (_mounted) return;
  const root = siteRoot();
  for (const rel of SCAD_FILES) {
    const url = new URL(rel, root).href;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`Failed to fetch ${rel}: ${err.message}`);
    }
    if (!res.ok) {
      // Optional file may not exist; only the must-have set is enforced
      // by the SCAD compile step. Skip 404s silently — OpenSCAD will
      // report a missing file by name if it actually needs it.
      continue;
    }
    const text = await res.text();
    const path = "/" + rel;
    const dir = path.substring(0, path.lastIndexOf("/"));
    mkdirP(instance, dir);
    instance.FS.writeFile(path, text);
  }
  // Output dir
  mkdirP(instance, "/output");
  _mounted = true;
}

function mkdirP(instance, dir) {
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    try { instance.FS.mkdir(cur); } catch (_) { /* exists */ }
  }
}

function formatParam(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(formatParam).join(",") + "]";
  throw new Error(`Unsupported SCAD param: ${v}`);
}

/**
 * Render a SCAD file to a binary STL.
 * @param {string} scadPath - path inside web/ (e.g. "scad/standard.scad").
 * @param {Record<string, any>} params - file-scope variable overrides.
 * @returns {Promise<Uint8Array>} STL bytes.
 */
export async function renderStl(scadPath, params = {}) {
  const instance = await ensureInstance();
  await ensureMounted(instance);

  const inFs = "/" + scadPath;
  const outFs = "/output/out.stl";
  // Clear any previous output to avoid reading stale bytes on failure.
  try { instance.FS.unlink(outFs); } catch (_) { /* fine */ }

  const args = ["-o", outFs, "--export-format", "binstl"];
  for (const [k, v] of Object.entries(params)) {
    args.push("-D", `${k}=${formatParam(v)}`);
  }
  args.push(inFs);

  const exitCode = instance.callMain(args);
  if (exitCode !== 0 && exitCode !== undefined) {
    throw new Error(`openscad exited with code ${exitCode}`);
  }
  let stl;
  try {
    stl = instance.FS.readFile(outFs);
  } catch (err) {
    throw new Error(`openscad produced no STL output: ${err.message}`);
  }
  return stl;
}
