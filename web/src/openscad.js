// Thin proxy: posts render requests to the openscad worker and resolves
// promises when results come back. Keeps the main thread responsive so
// Chrome doesn't show "page unresponsive" while WASM is grinding.

let _worker = null;
let _nextId = 0;
const _pending = new Map();

function ensureWorker() {
  if (_worker) return _worker;
  _worker = new Worker(new URL("./openscad-worker.js", import.meta.url), {
    type: "module",
  });
  _worker.onmessage = (e) => {
    const { id, ok, bytes, message } = e.data;
    const handler = _pending.get(id);
    if (!handler) return;
    _pending.delete(id);
    if (ok) handler.resolve(new Uint8Array(bytes));
    else handler.reject(new Error(message || "openscad render failed"));
  };
  _worker.onerror = (e) => {
    // Top-level worker error (rare — usually module load failure).
    for (const h of _pending.values()) h.reject(new Error(e.message || "worker error"));
    _pending.clear();
    _worker = null;
  };
  return _worker;
}

/**
 * Render a SCAD file to a binary STL via the openscad worker.
 * @param {string} scadPath - path inside web/ (e.g. "scad/standard.scad").
 * @param {Record<string, any>} params - file-scope variable overrides.
 * @returns {Promise<Uint8Array>} STL bytes.
 */
export function renderStl(scadPath, params = {}) {
  const w = ensureWorker();
  const id = _nextId++;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    w.postMessage({ id, scadPath, params });
  });
}
