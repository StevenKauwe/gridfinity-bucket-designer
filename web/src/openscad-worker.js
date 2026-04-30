// Web Worker that owns the openscad-wasm instance. Keeps the main thread
// responsive — Chrome no longer flags "page unresponsive" while a render is
// in flight.

import OpenSCAD from "../vendor/openscad/openscad.js";

const SCAD_FILES = [
  "scad/standard.scad",
  "scad/baseplate.scad",
  "scad/overflow.scad",
  "vendor/gridfinity-rebuilt-openscad/gridfinity-rebuilt-baseplate.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/standard.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/base.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/bin.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/cutouts.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-baseplate.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-holes.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-utility.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/tab.scad",
  "vendor/gridfinity-rebuilt-openscad/src/core/wall.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/angles.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/dictionary.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/generic-helpers.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/grid.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/grid_element.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/list.scad",
  "vendor/gridfinity-rebuilt-openscad/src/helpers/shapes.scad",
  "vendor/gridfinity-rebuilt-openscad/src/external/threads-scad/threads.scad",
];

let _instance = null;
let _mounted = false;

function siteRoot() { return new URL("../", import.meta.url); }

async function ensureInstance() {
  if (_instance) return _instance;
  // Larger initial heap. The 2022.03.20 build allows memory growth, but
  // starting bigger avoids early-render OOM under CGAL pressure.
  _instance = await OpenSCAD({
    noInitialRun: true,
    INITIAL_MEMORY: 256 * 1024 * 1024,
  });
  return _instance;
}

function resetInstance() {
  // openscad-wasm's CGAL state can leak across renders — fresh instance
  // recovers from "memory access out of bounds" and similar mid-flight
  // failures. The mount cost (~5–20 ms in the worker) is amortized.
  _instance = null;
  _mounted = false;
}

function mkdirP(instance, dir) {
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    try { instance.FS.mkdir(cur); } catch (_) { /* exists */ }
  }
}

async function ensureMounted(instance) {
  if (_mounted) return;
  const root = siteRoot();
  for (const rel of SCAD_FILES) {
    const url = new URL(rel, root).href;
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) continue;
    const text = await res.text();
    const path = "/" + rel;
    mkdirP(instance, path.substring(0, path.lastIndexOf("/")));
    instance.FS.writeFile(path, text);
  }
  mkdirP(instance, "/output");
  _mounted = true;
}

function formatParam(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(formatParam).join(",") + "]";
  throw new Error(`Unsupported SCAD param: ${v}`);
}

async function render(scadPath, params) {
  const instance = await ensureInstance();
  await ensureMounted(instance);

  const inFs = "/" + scadPath;
  const outFs = "/output/out.stl";
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
  return instance.FS.readFile(outFs);
}

self.onmessage = async (e) => {
  const { id, scadPath, params } = e.data;
  try {
    const bytes = await render(scadPath, params);
    self.postMessage({ id, ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    const msg = err.message || String(err);
    // openscad-wasm sometimes corrupts its heap mid-render. One retry on a
    // fresh instance recovers ~all of the time.
    if (/memory access out of bounds|abort|RuntimeError/i.test(msg)) {
      try {
        resetInstance();
        const bytes = await render(scadPath, params);
        self.postMessage({ id, ok: true, bytes }, [bytes.buffer]);
        return;
      } catch (err2) {
        self.postMessage({ id, ok: false, message: `${err2.message || err2} (after recreate)` });
        return;
      }
    }
    self.postMessage({ id, ok: false, message: msg });
  }
};
