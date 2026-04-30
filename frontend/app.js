// Gridfinity Bucket Designer — vanilla JS frontend.
import { openPreview } from "./preview.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  project: defaultProject(),
  tool: "draw-base",
  snap: true,
  selectedId: null,
  scale: 1.5, // px per mm
  undo: [],
  redo: [],
};

function defaultProject() {
  return {
    version: "0.1.0",
    drawer: { width_mm: 500, depth_mm: 420, height_mm: 80 },
    grid: { cell_mm: 42, clearance_mm: 0.25, origin_x_mm: 0, origin_y_mm: 0 },
    printer: { bed_x_mm: 256, bed_y_mm: 256, bed_z_mm: 256 },
    defaults: {
      wall_thickness_mm: 0.95, floor_thickness_mm: 0.7,
      corner_radius_mm: 3.75, bucket_height_mm: 42,
    },
    buckets: [],
  };
}

const editor = document.getElementById("editor");

// ---------- Coordinate helpers ----------
function mmToPx(v) { return v * state.scale; }
function pxToMm(v) { return v / state.scale; }

function svgPoint(evt) {
  const rect = editor.getBoundingClientRect();
  return { x: pxToMm(evt.clientX - rect.left), y: pxToMm(evt.clientY - rect.top) };
}

function snapMm(v, cell) {
  if (!state.snap) return v;
  return Math.round(v / cell) * cell;
}

function snapToGridCell(v, cell) {
  return Math.round(v / cell);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function startCellForDraw(v, max, cell) {
  const fullCells = Math.floor(max / cell);
  if (fullCells > 0 && v >= fullCells * cell) return fullCells - 1;
  return Math.max(0, Math.floor(v / cell));
}

function edgeAwareSpan(startCell, currentMm, axisMax, cell) {
  const eps = 0.001;
  const startMm = startCell * cell;
  const current = clamp(currentMm, 0, axisMax);
  const fullCells = Math.floor(axisMax / cell);

  if (current >= startMm) {
    const endCell = current >= axisMax - eps ? fullCells : Math.ceil(current / cell);
    const cells = Math.max(1, endCell - startCell);
    const endMm = current >= axisMax - eps ? axisMax : (startCell + cells) * cell;
    return { cellStart: startCell, cells, bodyStart: startMm, bodySize: Math.max(1, endMm - startMm) };
  }

  const cellStart = Math.max(0, Math.floor(current / cell));
  const cells = Math.max(1, startCell - cellStart + 1);
  const bodyStart = cellStart * cell;
  return { cellStart, cells, bodyStart, bodySize: cells * cell };
}

function drawRectFromDrag(startCellX, startCellY, p) {
  const cell = state.project.grid.cell_mm;
  const x = edgeAwareSpan(startCellX, p.x, state.project.drawer.width_mm, cell);
  const y = edgeAwareSpan(startCellY, p.y, state.project.drawer.depth_mm, cell);
  return {
    cells: { x: x.cellStart, y: y.cellStart, w: x.cells, d: y.cells },
    body: { x: x.bodyStart, y: y.bodyStart, w: x.bodySize, d: y.bodySize },
  };
}

// ---------- Undo / Redo ----------
function snapshot() {
  state.undo.push(JSON.stringify(state.project));
  if (state.undo.length > 50) state.undo.shift();
  state.redo.length = 0;
}
function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.project));
  state.project = JSON.parse(state.undo.pop());
  syncToolbarFromProject();
  render();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.project));
  state.project = JSON.parse(state.redo.pop());
  syncToolbarFromProject();
  render();
}

// ---------- Render ----------
function render() {
  while (editor.firstChild) editor.removeChild(editor.firstChild);

  const cell = state.project.grid.cell_mm;
  const nextGridX = Math.ceil(state.project.drawer.width_mm / cell) * cell;
  const nextGridY = Math.ceil(state.project.drawer.depth_mm / cell) * cell;
  const canvasWidthMm = Math.max(state.project.drawer.width_mm, nextGridX) + (nextGridX > state.project.drawer.width_mm ? 4 : 0);
  const canvasDepthMm = Math.max(state.project.drawer.depth_mm, nextGridY) + (nextGridY > state.project.drawer.depth_mm ? 4 : 0);
  const W = mmToPx(state.project.drawer.width_mm);
  const D = mmToPx(state.project.drawer.depth_mm);
  const canvasW = mmToPx(canvasWidthMm);
  const canvasD = mmToPx(canvasDepthMm);
  editor.setAttribute("width", canvasW);
  editor.setAttribute("height", canvasD);
  editor.setAttribute("viewBox", `0 0 ${canvasW} ${canvasD}`);

  // Drawer outline
  const outline = document.createElementNS(SVG_NS, "rect");
  outline.setAttribute("class", "drawer-outline");
  outline.setAttribute("x", 0);
  outline.setAttribute("y", 0);
  outline.setAttribute("width", W);
  outline.setAttribute("height", D);
  editor.appendChild(outline);

  // Grid
  for (let x = 0; x <= state.project.drawer.width_mm + 0.001; x += cell) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "grid-line");
    line.setAttribute("x1", mmToPx(x));
    line.setAttribute("x2", mmToPx(x));
    line.setAttribute("y1", 0);
    line.setAttribute("y2", D);
    editor.appendChild(line);
  }
  for (let y = 0; y <= state.project.drawer.depth_mm + 0.001; y += cell) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "grid-line");
    line.setAttribute("x1", 0);
    line.setAttribute("x2", W);
    line.setAttribute("y1", mmToPx(y));
    line.setAttribute("y2", mmToPx(y));
    editor.appendChild(line);
  }

  if (nextGridX > state.project.drawer.width_mm + 0.001) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "outside-grid-line");
    line.setAttribute("x1", mmToPx(nextGridX));
    line.setAttribute("x2", mmToPx(nextGridX));
    line.setAttribute("y1", 0);
    line.setAttribute("y2", D);
    editor.appendChild(line);
  }
  if (nextGridY > state.project.drawer.depth_mm + 0.001) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "outside-grid-line");
    line.setAttribute("x1", 0);
    line.setAttribute("x2", W);
    line.setAttribute("y1", mmToPx(nextGridY));
    line.setAttribute("y2", mmToPx(nextGridY));
    editor.appendChild(line);
  }

  // Buckets
  validateThenDraw();
}

async function validateThenDraw() {
  const issues = await runValidate();
  const issuesByBucket = {};
  for (const it of issues) {
    if (!it.bucket_id) continue;
    (issuesByBucket[it.bucket_id] ||= []).push(it);
  }

  for (const b of state.project.buckets) {
    drawBucket(b, !!issuesByBucket[b.id]);
  }

  renderIssuesPanel(issues);
}

function drawBucket(b, invalid) {
  const cell = state.project.grid.cell_mm;

  // Body
  const body = document.createElementNS(SVG_NS, "rect");
  body.setAttribute("class", "bucket-body" + (state.selectedId === b.id ? " selected" : "") + (invalid ? " bucket-invalid" : ""));
  body.setAttribute("x", mmToPx(b.body_mm.x));
  body.setAttribute("y", mmToPx(b.body_mm.y));
  body.setAttribute("width", mmToPx(b.body_mm.w));
  body.setAttribute("height", mmToPx(b.body_mm.d));
  body.setAttribute("rx", mmToPx(b.corner_radius_mm || 0));
  body.dataset.id = b.id;
  body.addEventListener("mousedown", (e) => onBucketMouseDown(e, b));
  editor.appendChild(body);

  // Base (dashed)
  const base = document.createElementNS(SVG_NS, "rect");
  base.setAttribute("class", "bucket-base");
  base.setAttribute("x", mmToPx(b.base_cells.x * cell));
  base.setAttribute("y", mmToPx(b.base_cells.y * cell));
  base.setAttribute("width", mmToPx(b.base_cells.w * cell));
  base.setAttribute("height", mmToPx(b.base_cells.d * cell));
  editor.appendChild(base);

  if (state.selectedId === b.id && b.split?.enabled && b.split?.strategy === "naive") {
    drawNaiveSplitPreview(b);
  }

  // Resize handles when selected
  if (state.selectedId === b.id) {
    const editingBody = state.tool === "edit-body";
    const target = editingBody ? b.body_mm : null;
    if (editingBody) {
      drawHandle(b.body_mm.x + b.body_mm.w, b.body_mm.y + b.body_mm.d, b, "body-se");
    } else {
      // base handle in mm at SE corner of base footprint
      drawHandle((b.base_cells.x + b.base_cells.w) * cell, (b.base_cells.y + b.base_cells.d) * cell, b, "base-se");
    }
  }
}

function drawHandle(xMm, yMm, b, kind) {
  const h = document.createElementNS(SVG_NS, "rect");
  h.setAttribute("class", "handle");
  const s = 8;
  h.setAttribute("x", mmToPx(xMm) - s / 2);
  h.setAttribute("y", mmToPx(yMm) - s / 2);
  h.setAttribute("width", s);
  h.setAttribute("height", s);
  h.addEventListener("mousedown", (e) => onHandleMouseDown(e, b, kind));
  editor.appendChild(h);
}

function drawNaiveSplitPreview(b) {
  const bedX = state.project.printer.bed_x_mm;
  const bedY = state.project.printer.bed_y_mm;
  if (bedX <= 0 || bedY <= 0) return;

  const cell = state.project.grid.cell_mm;
  const xRanges = splitAxisOnBaseCells({
    baseStart: b.base_cells.x,
    baseCount: b.base_cells.w,
    bodyStart: b.body_mm.x,
    bodySize: b.body_mm.w,
    bedSize: bedX,
    cell,
  });
  const yRanges = splitAxisOnBaseCells({
    baseStart: b.base_cells.y,
    baseCount: b.base_cells.d,
    bodyStart: b.body_mm.y,
    bodySize: b.body_mm.d,
    bedSize: bedY,
    cell,
  });

  for (let i = 1; i < xRanges.length; i += 1) {
    const x = xRanges[i].bodyStart;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "split-line");
    line.setAttribute("x1", mmToPx(x));
    line.setAttribute("x2", mmToPx(x));
    line.setAttribute("y1", mmToPx(b.body_mm.y));
    line.setAttribute("y2", mmToPx(b.body_mm.y + b.body_mm.d));
    editor.appendChild(line);
  }

  for (let i = 1; i < yRanges.length; i += 1) {
    const y = yRanges[i].bodyStart;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "split-line");
    line.setAttribute("x1", mmToPx(b.body_mm.x));
    line.setAttribute("x2", mmToPx(b.body_mm.x + b.body_mm.w));
    line.setAttribute("y1", mmToPx(y));
    line.setAttribute("y2", mmToPx(y));
    editor.appendChild(line);
  }
}

function splitAxisOnBaseCells({ baseStart, baseCount, bodyStart, bodySize, bedSize, cell }) {
  const maxCells = Math.max(1, Math.floor(bedSize / cell));
  const bodyEnd = bodyStart + bodySize;
  const ranges = [];
  let cursor = baseStart;
  const baseEnd = baseStart + baseCount;

  while (cursor < baseEnd) {
    const remaining = baseEnd - cursor;
    let chosen = null;
    for (let cells = Math.min(maxCells, remaining); cells >= 1; cells -= 1) {
      const nextCursor = cursor + cells;
      const partBodyStart = cursor === baseStart ? bodyStart : cursor * cell;
      const partBodyEnd = nextCursor === baseEnd ? bodyEnd : nextCursor * cell;
      const partBodySize = partBodyEnd - partBodyStart;
      if (partBodySize <= bedSize) {
        chosen = { baseStart: cursor, cells, bodyStart: partBodyStart, bodySize: partBodySize };
        break;
      }
    }
    if (!chosen) return [];
    ranges.push(chosen);
    cursor += chosen.cells;
  }

  return ranges;
}

// ---------- Validate ----------
async function runValidate() {
  try {
    const res = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.project),
    });
    const data = await res.json();
    return data.issues || [];
  } catch (e) {
    return [];
  }
}

function renderIssuesPanel(issues) {
  const ul = document.getElementById("issues");
  ul.innerHTML = "";
  for (const i of issues) {
    const li = document.createElement("li");
    li.className = i.severity;
    li.textContent = `[${i.severity}] ${i.code}: ${i.message}`;
    ul.appendChild(li);
  }
}

// ---------- Interaction ----------
let dragState = null;

editor.addEventListener("mousedown", (e) => {
  if (e.target !== editor) return;
  const p = svgPoint(e);
  if (state.tool === "draw-base") {
    const cell = state.project.grid.cell_mm;
    const cx = startCellForDraw(p.x, state.project.drawer.width_mm, cell);
    const cy = startCellForDraw(p.y, state.project.drawer.depth_mm, cell);
    dragState = { kind: "draw-base", startCellX: cx, startCellY: cy, draftEl: null };
  } else if (state.tool === "select" || state.tool === "edit-body" || state.tool === "delete") {
    selectBucket(null);
    render();
  }
});

editor.addEventListener("mousemove", (e) => {
  if (!dragState) return;
  const p = svgPoint(e);
  const cell = state.project.grid.cell_mm;

  if (dragState.kind === "draw-base") {
    const draft = drawRectFromDrag(dragState.startCellX, dragState.startCellY, p);
    if (!dragState.draftEl) {
      dragState.draftEl = document.createElementNS(SVG_NS, "rect");
      dragState.draftEl.setAttribute("class", "draft");
      editor.appendChild(dragState.draftEl);
    }
    dragState.draftEl.setAttribute("x", mmToPx(draft.body.x));
    dragState.draftEl.setAttribute("y", mmToPx(draft.body.y));
    dragState.draftEl.setAttribute("width", mmToPx(draft.body.w));
    dragState.draftEl.setAttribute("height", mmToPx(draft.body.d));
    dragState.cells = draft.cells;
    dragState.body = draft.body;
  } else if (dragState.kind === "move-bucket") {
    const dx = p.x - dragState.lastX;
    const dy = p.y - dragState.lastY;
    dragState.lastX = p.x;
    dragState.lastY = p.y;
    const b = state.project.buckets.find((x) => x.id === dragState.bucketId);
    if (!b) return;
    if (state.snap) {
      // snap base to whole cells; move body by same delta
      const cell = state.project.grid.cell_mm;
      dragState.accumX = (dragState.accumX || 0) + dx;
      dragState.accumY = (dragState.accumY || 0) + dy;
      const dxCells = Math.round(dragState.accumX / cell);
      const dyCells = Math.round(dragState.accumY / cell);
      if (dxCells || dyCells) {
        b.base_cells.x += dxCells;
        b.base_cells.y += dyCells;
        b.body_mm.x += dxCells * cell;
        b.body_mm.y += dyCells * cell;
        dragState.accumX -= dxCells * cell;
        dragState.accumY -= dyCells * cell;
        render();
      }
    } else {
      b.body_mm.x += dx;
      b.body_mm.y += dy;
      const cell = state.project.grid.cell_mm;
      b.base_cells.x = Math.round(b.body_mm.x / cell);
      b.base_cells.y = Math.round(b.body_mm.y / cell);
      render();
    }
  } else if (dragState.kind === "resize-base") {
    const cell = state.project.grid.cell_mm;
    const b = state.project.buckets.find((x) => x.id === dragState.bucketId);
    if (!b) return;
    const cx = snapToGridCell(p.x, cell);
    const cy = snapToGridCell(p.y, cell);
    b.base_cells.w = Math.max(1, cx - b.base_cells.x);
    b.base_cells.d = Math.max(1, cy - b.base_cells.y);
    // also resize body to match base when no overflow editing
    b.body_mm.w = b.base_cells.w * cell;
    b.body_mm.d = b.base_cells.d * cell;
    render();
  } else if (dragState.kind === "resize-body") {
    const b = state.project.buckets.find((x) => x.id === dragState.bucketId);
    if (!b) return;
    const newW = Math.max(5, p.x - b.body_mm.x);
    const newD = Math.max(5, p.y - b.body_mm.y);
    b.body_mm.w = state.snap ? Math.round(newW * 2) / 2 : newW;
    b.body_mm.d = state.snap ? Math.round(newD * 2) / 2 : newD;
    render();
  }
});

window.addEventListener("mouseup", () => {
  if (!dragState) return;
  if (dragState.kind === "draw-base" && dragState.cells) {
    snapshot();
    const cell = state.project.grid.cell_mm;
    const c = dragState.cells;
    const body = dragState.body || { x: c.x * cell, y: c.y * cell, w: c.w * cell, d: c.d * cell };
    const id = `bucket-${Date.now()}`;
    state.project.buckets.push({
      id,
      name: `Bucket ${state.project.buckets.length + 1}`,
      base_cells: { ...c },
      body_mm: { ...body },
      height_mm: state.project.defaults.bucket_height_mm,
      wall_thickness_mm: state.project.defaults.wall_thickness_mm,
      floor_thickness_mm: state.project.defaults.floor_thickness_mm,
      corner_radius_mm: state.project.defaults.corner_radius_mm,
      label: { enabled: false, text: "", style: "front-scoop" },
      dividers: [],
      connectors: { enabled: false, type: "none" },
      split: { enabled: true, strategy: "naive", parts: [] },
      include_lip: true,
      magnet_holes: false,
      screw_holes: false,
      only_corners_holes: false,
      scoop: 0,
      style_tab: 5,
    });
    selectBucket(id);
  }
  if (dragState.draftEl) dragState.draftEl.remove();
  dragState = null;
  render();
});

function onBucketMouseDown(e, b) {
  e.stopPropagation();
  if (state.tool === "delete") {
    snapshot();
    state.project.buckets = state.project.buckets.filter((x) => x.id !== b.id);
    if (state.selectedId === b.id) selectBucket(null);
    render();
    return;
  }
  selectBucket(b.id);
  if (state.tool === "select") {
    snapshot();
    const p = svgPoint(e);
    dragState = { kind: "move-bucket", bucketId: b.id, lastX: p.x, lastY: p.y };
  }
  render();
}

function onHandleMouseDown(e, b, kind) {
  e.stopPropagation();
  snapshot();
  if (kind === "base-se") {
    dragState = { kind: "resize-base", bucketId: b.id };
  } else if (kind === "body-se") {
    dragState = { kind: "resize-body", bucketId: b.id };
  }
}

function selectBucket(id) {
  state.selectedId = id;
  syncPropsPanel();
}

// ---------- Properties panel ----------
function syncPropsPanel() {
  const noSel = document.getElementById("noSelection");
  const props = document.getElementById("bucketProps");
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) { noSel.hidden = false; props.hidden = true; return; }
  noSel.hidden = true; props.hidden = false;
  document.getElementById("propName").value = b.name;
  document.getElementById("propHeight").value = b.height_mm;
  document.getElementById("propWall").value = b.wall_thickness_mm;
  document.getElementById("propFloor").value = b.floor_thickness_mm;
  document.getElementById("propRadius").value = b.corner_radius_mm;
  document.getElementById("propBaseX").value = b.base_cells.x;
  document.getElementById("propBaseY").value = b.base_cells.y;
  document.getElementById("propBaseW").value = b.base_cells.w;
  document.getElementById("propBaseD").value = b.base_cells.d;
  document.getElementById("propBodyX").value = b.body_mm.x;
  document.getElementById("propBodyY").value = b.body_mm.y;
  document.getElementById("propBodyW").value = b.body_mm.w;
  document.getElementById("propBodyD").value = b.body_mm.d;
  document.getElementById("propNaiveSplit").checked = !!b.split?.enabled && b.split?.strategy === "naive";
  document.getElementById("propIncludeLip").checked = b.include_lip !== false;
  document.getElementById("propMagnetHoles").checked = !!b.magnet_holes;
  document.getElementById("propScrewHoles").checked = !!b.screw_holes;
  document.getElementById("propOnlyCornersHoles").checked = !!b.only_corners_holes;
  document.getElementById("propScoop").value = b.scoop ?? 0;
  document.getElementById("propStyleTab").value = String(b.style_tab ?? 5);
}

function bindPropInput(id, fn) {
  document.getElementById(id).addEventListener("change", (e) => {
    const b = state.project.buckets.find((x) => x.id === state.selectedId);
    if (!b) return;
    snapshot();
    fn(b, e.target.value);
    render();
  });
}
bindPropInput("propName", (b, v) => (b.name = v));
bindPropInput("propHeight", (b, v) => (b.height_mm = +v));
bindPropInput("propWall", (b, v) => (b.wall_thickness_mm = +v));
bindPropInput("propFloor", (b, v) => (b.floor_thickness_mm = +v));
bindPropInput("propRadius", (b, v) => (b.corner_radius_mm = +v));
bindPropInput("propBaseX", (b, v) => (b.base_cells.x = +v));
bindPropInput("propBaseY", (b, v) => (b.base_cells.y = +v));
bindPropInput("propBaseW", (b, v) => (b.base_cells.w = Math.max(1, +v)));
bindPropInput("propBaseD", (b, v) => (b.base_cells.d = Math.max(1, +v)));
bindPropInput("propBodyX", (b, v) => (b.body_mm.x = +v));
bindPropInput("propBodyY", (b, v) => (b.body_mm.y = +v));
bindPropInput("propBodyW", (b, v) => (b.body_mm.w = +v));
bindPropInput("propBodyD", (b, v) => (b.body_mm.d = +v));

function bindCheckbox(id, fn) {
  document.getElementById(id).addEventListener("change", (e) => {
    const b = state.project.buckets.find((x) => x.id === state.selectedId);
    if (!b) return;
    snapshot();
    fn(b, e.target.checked);
    render();
  });
}
bindCheckbox("propIncludeLip", (b, v) => (b.include_lip = v));
bindCheckbox("propMagnetHoles", (b, v) => (b.magnet_holes = v));
bindCheckbox("propScrewHoles", (b, v) => (b.screw_holes = v));
bindCheckbox("propOnlyCornersHoles", (b, v) => (b.only_corners_holes = v));
bindPropInput("propScoop", (b, v) => (b.scoop = Math.max(0, Math.min(1, +v))));
bindPropInput("propStyleTab", (b, v) => (b.style_tab = +v));

document.getElementById("propNaiveSplit").addEventListener("change", (e) => {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) return;
  snapshot();
  b.split = b.split || { enabled: false, strategy: "auto", parts: [] };
  b.split.enabled = e.target.checked;
  b.split.strategy = e.target.checked ? "naive" : "auto";
  b.split.parts = [];
  render();
});

// Standard Gridfinity bin parameters (per the public spec):
//   cell:   42 mm
//   height: 7 mm units; 6u = 42 mm is the canonical bin height
//   walls:  0.95 mm (single 0.4 perim, 2 walls)
//   floor:  ~0.7 mm above foot top
//   corner radius (outer): 3.75 mm (so it tracks the 7.5 mm corner of the cell)
const GRIDFINITY_DEFAULTS = {
  height_mm: 42,
  wall_thickness_mm: 0.95,
  floor_thickness_mm: 0.7,
  corner_radius_mm: 3.75,
};

document.getElementById("previewStl").addEventListener("click", async () => {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) { alert("Select a bucket to preview."); return; }
  const btn = document.getElementById("previewStl");
  const orig = btn.textContent;
  btn.textContent = "Rendering…"; btn.disabled = true;
  try {
    const res = await fetch("/api/export/stl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: state.project, bucket_ids: [b.id] }),
    });
    if (!res.ok) throw new Error(await res.text());
    const stl = new Uint8Array(await res.arrayBuffer());
    openPreview(stl, b.name || b.id);
  } catch (err) {
    console.error(err);
    alert("Preview failed: " + err.message);
  } finally {
    btn.textContent = orig; btn.disabled = false;
  }
});

document.getElementById("setGridfinityDefaults").addEventListener("click", () => {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) return;
  snapshot();
  const cell = state.project.grid.cell_mm;
  const clearance = state.project.grid.clearance_mm || 0;
  // Body matches base footprint, inset by clearance on all sides.
  b.body_mm = {
    x: b.base_cells.x * cell + clearance,
    y: b.base_cells.y * cell + clearance,
    w: b.base_cells.w * cell - 2 * clearance,
    d: b.base_cells.d * cell - 2 * clearance,
  };
  Object.assign(b, GRIDFINITY_DEFAULTS);
  syncPropsPanel();
  render();
});

document.getElementById("resetBody").addEventListener("click", () => {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) return;
  snapshot();
  const cell = state.project.grid.cell_mm;
  b.body_mm = {
    x: b.base_cells.x * cell, y: b.base_cells.y * cell,
    w: b.base_cells.w * cell, d: b.base_cells.d * cell,
  };
  syncPropsPanel(); render();
});

// ---------- Toolbar ----------
function bindNumberInput(id, fn) {
  document.getElementById(id).addEventListener("change", (e) => {
    snapshot();
    fn(+e.target.value);
    render();
  });
}
bindNumberInput("drawerW", (v) => (state.project.drawer.width_mm = v));
bindNumberInput("drawerD", (v) => (state.project.drawer.depth_mm = v));
bindNumberInput("gridSize", (v) => (state.project.grid.cell_mm = v));
bindNumberInput("bedX", (v) => (state.project.printer.bed_x_mm = v));
bindNumberInput("bedY", (v) => (state.project.printer.bed_y_mm = v));

document.getElementById("snapToggle").addEventListener("click", (e) => {
  state.snap = !state.snap;
  e.target.textContent = `Snap: ${state.snap ? "ON" : "OFF"}`;
  e.target.classList.toggle("active", state.snap);
});

document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);

document.querySelectorAll("#tools button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tools button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tool = btn.dataset.tool;
    render();
  });
});

// ---------- Export / Import ----------
document.getElementById("exportJson").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: "application/json" });
  triggerDownload(blob, "gridfinity-project.json");
});

document.getElementById("exportStl").addEventListener("click", async () => {
  if (!state.project.buckets.length) { alert("No buckets to export."); return; }
  const ids = state.selectedId ? [state.selectedId] : state.project.buckets.map((b) => b.id);
  const res = await fetch("/api/export/stl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: state.project, bucket_ids: ids }),
  });
  if (!res.ok) { alert("Export failed: " + (await res.text())); return; }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^";]+)"?/.exec(cd);
  triggerDownload(blob, m ? m[1] : "bucket.stl");
});

document.getElementById("exportBaseplate").addEventListener("click", async () => {
  const params = new URLSearchParams({ split: "true", enable_magnet: "false", style_plate: "0", style_hole: "0" });
  const res = await fetch(`/api/export/baseplate?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.project),
  });
  if (!res.ok) { alert("Baseplate export failed: " + (await res.text())); return; }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^";]+)"?/.exec(cd);
  triggerDownload(blob, m ? m[1] : "baseplate.stl");
});

document.getElementById("exportBundle").addEventListener("click", async () => {
  const res = await fetch("/api/export/bundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.project),
  });
  if (!res.ok) { alert("Export failed: " + (await res.text())); return; }
  triggerDownload(await res.blob(), "gridfinity-project.zip");
});

document.getElementById("loadJson").addEventListener("click", () => {
  document.getElementById("jsonFile").click();
});
document.getElementById("jsonFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await f.text();
  try {
    snapshot();
    state.project = JSON.parse(text);
    syncToolbarFromProject();
    selectBucket(null);
    render();
  } catch (err) {
    alert("Invalid JSON: " + err.message);
  }
});

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function syncToolbarFromProject() {
  document.getElementById("drawerW").value = state.project.drawer.width_mm;
  document.getElementById("drawerD").value = state.project.drawer.depth_mm;
  document.getElementById("gridSize").value = state.project.grid.cell_mm;
  document.getElementById("bedX").value = state.project.printer.bed_x_mm;
  document.getElementById("bedY").value = state.project.printer.bed_y_mm;
}

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (e.key === "Delete" || e.key === "Backspace") {
    if (state.selectedId && document.activeElement === document.body) {
      snapshot();
      state.project.buckets = state.project.buckets.filter((b) => b.id !== state.selectedId);
      selectBucket(null);
      render();
    }
  }
});

render();
