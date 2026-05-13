// Gridfinity Bucket Designer — vanilla JS frontend (browser-only WASM build).
import {
  defaultProject as _defaultProject,
  defaultBucket,
  hydrateBucketCells,
  bucketCellSet,
  cellKey,
  recomputeBoundsFromCells,
  translateBucketCells,
  rotateBucketCells90,
} from "./src/models.js";
import { validateProject } from "./src/validate.js";
import { naiveSplitBucket, balancedBaseplateAxisCells } from "./src/split.js";
import { generateBucketStl, generateBaseplateStl } from "./src/cad.js";
import { openPreview, openPreviewScene } from "./src/preview.js";

// JSZip from CDN for multi-file export.
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const SVG_NS = "http://www.w3.org/2000/svg";
const defaultProject = _defaultProject;

// Drawer wall thickness for visualization (mm). Purely visual — does not
// reduce interior buildable area.
const DRAWER_WALL_MM = 16;

const state = {
  project: defaultProject(),
  tool: "box",
  snap: true,
  selectedId: null,
  scale: 1.5, // px per mm
  undo: [],
  redo: [],
};

const editor = document.getElementById("editor");

// ---------- Coordinate helpers ----------
function mmToPx(v) { return v * state.scale; }
function pxToMm(v) { return v / state.scale; }

function svgPoint(evt) {
  const rect = editor.getBoundingClientRect();
  return {
    x: pxToMm(evt.clientX - rect.left) - DRAWER_WALL_MM,
    y: pxToMm(evt.clientY - rect.top) - DRAWER_WALL_MM,
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function pointToCell(p) {
  const cell = state.project.grid.cell_mm;
  return { cx: Math.floor(p.x / cell), cy: Math.floor(p.y / cell) };
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

// Find which bucket owns a given cell (if any). Returns bucket or null.
function bucketAtCell(cx, cy) {
  for (let i = state.project.buckets.length - 1; i >= 0; i--) {
    const b = state.project.buckets[i];
    const set = bucketCellSet(b);
    if (set.has(cellKey(cx, cy))) return b;
  }
  return null;
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
  hydrateAllBuckets();
  syncToolbarFromProject();
  render();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.project));
  state.project = JSON.parse(state.redo.pop());
  hydrateAllBuckets();
  syncToolbarFromProject();
  render();
}

function hydrateAllBuckets() {
  for (const b of state.project.buckets) hydrateBucketCells(b);
}

// ---------- Render ----------
function render() {
  while (editor.firstChild) editor.removeChild(editor.firstChild);

  const cell = state.project.grid.cell_mm;
  const drawerW = state.project.drawer.width_mm;
  const drawerD = state.project.drawer.depth_mm;
  const wallMm = DRAWER_WALL_MM;

  const totalW = drawerW + 2 * wallMm;
  const totalD = drawerD + 2 * wallMm;
  const W = mmToPx(drawerW);
  const D = mmToPx(drawerD);
  const TW = mmToPx(totalW);
  const TD = mmToPx(totalD);
  const WALL = mmToPx(wallMm);

  editor.setAttribute("width", TW);
  editor.setAttribute("height", TD);
  editor.setAttribute("viewBox", `0 0 ${TW} ${TD}`);

  // Drawer body (walls)
  const outer = document.createElementNS(SVG_NS, "rect");
  outer.setAttribute("class", "drawer-walls");
  outer.setAttribute("x", 0);
  outer.setAttribute("y", 0);
  outer.setAttribute("width", TW);
  outer.setAttribute("height", TD);
  outer.setAttribute("rx", mmToPx(8));
  editor.appendChild(outer);

  // Interior group: shift content by drawer wall thickness so cell coords
  // match svgPoint() output (which subtracts DRAWER_WALL_MM).
  const interior = document.createElementNS(SVG_NS, "g");
  interior.setAttribute("transform", `translate(${WALL},${WALL})`);
  editor.appendChild(interior);

  // Drawer interior background
  const inside = document.createElementNS(SVG_NS, "rect");
  inside.setAttribute("class", "drawer-interior");
  inside.setAttribute("x", 0);
  inside.setAttribute("y", 0);
  inside.setAttribute("width", W);
  inside.setAttribute("height", D);
  interior.appendChild(inside);

  // Grid lines
  for (let x = 0; x <= drawerW + 0.001; x += cell) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "grid-line");
    line.setAttribute("x1", mmToPx(x));
    line.setAttribute("x2", mmToPx(x));
    line.setAttribute("y1", 0);
    line.setAttribute("y2", D);
    interior.appendChild(line);
  }
  for (let y = 0; y <= drawerD + 0.001; y += cell) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "grid-line");
    line.setAttribute("x1", 0);
    line.setAttribute("x2", W);
    line.setAttribute("y1", mmToPx(y));
    line.setAttribute("y2", mmToPx(y));
    interior.appendChild(line);
  }

  // Drawer outline (interior)
  const outline = document.createElementNS(SVG_NS, "rect");
  outline.setAttribute("class", "drawer-outline");
  outline.setAttribute("x", 0);
  outline.setAttribute("y", 0);
  outline.setAttribute("width", W);
  outline.setAttribute("height", D);
  interior.appendChild(outline);

  // Buckets
  validateThenDraw(interior);

  // Hit layer (transparent, on top of grid but underneath buckets we want
  // to capture mousedowns on empty cells). We attach mousedown on `editor`
  // but svgPoint converts to interior-local coords.
}

async function validateThenDraw(group) {
  const issues = await runValidate();
  const issuesByBucket = {};
  for (const it of issues) {
    if (!it.bucket_id) continue;
    (issuesByBucket[it.bucket_id] ||= []).push(it);
  }

  for (const b of state.project.buckets) {
    drawBucket(group, b, !!issuesByBucket[b.id]);
  }

  renderIssuesPanel(issues);
}

function drawBucket(group, b, invalid) {
  const cell = state.project.grid.cell_mm;
  const selected = state.selectedId === b.id;

  // Each occupied cell as its own rounded rect.
  for (const [cx, cy] of b.cells_xy || []) {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("class", "bucket-cell" + (selected ? " selected" : "") + (invalid ? " bucket-invalid" : ""));
    r.setAttribute("x", mmToPx(cx * cell));
    r.setAttribute("y", mmToPx(cy * cell));
    r.setAttribute("width", mmToPx(cell));
    r.setAttribute("height", mmToPx(cell));
    r.setAttribute("rx", mmToPx(2));
    r.dataset.id = b.id;
    r.dataset.cx = cx;
    r.dataset.cy = cy;
    r.addEventListener("mousedown", (e) => onBucketCellMouseDown(e, b, cx, cy));
    group.appendChild(r);
  }

  // Body outline (mm-bbox).
  if (b.body_mm.w > 0 && b.body_mm.d > 0) {
    const body = document.createElementNS(SVG_NS, "rect");
    body.setAttribute("class", "bucket-body" + (selected ? " selected" : ""));
    body.setAttribute("x", mmToPx(b.body_mm.x));
    body.setAttribute("y", mmToPx(b.body_mm.y));
    body.setAttribute("width", mmToPx(b.body_mm.w));
    body.setAttribute("height", mmToPx(b.body_mm.d));
    body.setAttribute("rx", mmToPx(b.corner_radius_mm || 0));
    group.appendChild(body);
  }

  if (selected && b.split?.enabled && b.split?.strategy === "naive") {
    drawNaiveSplitPreview(group, b);
  }

  // Move handle in centroid of cells (always rendered, so user can grab it
  // to translate the bucket regardless of tool mode).
  if ((b.cells_xy || []).length > 0) {
    let sx = 0, sy = 0;
    for (const [cx, cy] of b.cells_xy) { sx += cx + 0.5; sy += cy + 0.5; }
    const cx = sx / b.cells_xy.length;
    const cy = sy / b.cells_xy.length;
    const handle = document.createElementNS(SVG_NS, "g");
    handle.setAttribute("class", "move-handle" + (selected ? " selected" : ""));
    handle.setAttribute("transform", `translate(${mmToPx(cx * cell)},${mmToPx(cy * cell)})`);
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("r", 11);
    handle.appendChild(ring);
    const cross = document.createElementNS(SVG_NS, "path");
    cross.setAttribute("d", "M-5,0 L5,0 M0,-5 L0,5");
    cross.setAttribute("class", "move-handle-cross");
    handle.appendChild(cross);
    handle.addEventListener("mousedown", (e) => onMoveHandleMouseDown(e, b));
    group.appendChild(handle);
  }
}

function drawNaiveSplitPreview(group, b) {
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
    group.appendChild(line);
  }

  for (let i = 1; i < yRanges.length; i += 1) {
    const y = yRanges[i].bodyStart;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "split-line");
    line.setAttribute("x1", mmToPx(b.body_mm.x));
    line.setAttribute("x2", mmToPx(b.body_mm.x + b.body_mm.w));
    line.setAttribute("y1", mmToPx(y));
    line.setAttribute("y2", mmToPx(y));
    group.appendChild(line);
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
    return validateProject(state.project);
  } catch (e) {
    console.error(e);
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
  // Drag-rect / paint on empty space. Bucket cells / handles handle their own
  // mousedown events (which call stopPropagation).
  const p = svgPoint(e);
  const { cx, cy } = pointToCell(p);
  const cell = state.project.grid.cell_mm;

  if (state.tool === "box") {
    const startCx = startCellForDraw(p.x, state.project.drawer.width_mm, cell);
    const startCy = startCellForDraw(p.y, state.project.drawer.depth_mm, cell);
    selectBucket(null);
    dragState = { kind: "box-draw", startCellX: startCx, startCellY: startCy, draftEl: null };
  } else if (state.tool === "path") {
    // Start a new bucket with this cell, then paint adjacent cells as drag.
    if (cx < 0 || cy < 0) return;
    snapshot();
    const id = `bucket-${Date.now()}`;
    const base = { x: cx, y: cy, w: 1, d: 1 };
    const body = { x: cx * cell, y: cy * cell, w: cell, d: cell };
    const b = defaultBucket(id, base, body, state.project.defaults);
    state.project.buckets.push(b);
    selectBucket(id);
    dragState = { kind: "path-paint", bucketId: id };
    render();
  }
});

editor.addEventListener("mousemove", (e) => {
  if (!dragState) return;
  const p = svgPoint(e);
  const cell = state.project.grid.cell_mm;

  if (dragState.kind === "box-draw") {
    const draft = drawRectFromDrag(dragState.startCellX, dragState.startCellY, p);
    if (!dragState.draftEl) {
      dragState.draftEl = document.createElementNS(SVG_NS, "rect");
      dragState.draftEl.setAttribute("class", "draft");
      // Append draft into the interior group (last <g> child of editor).
      const group = editor.querySelector("g");
      group.appendChild(dragState.draftEl);
    }
    dragState.draftEl.setAttribute("x", mmToPx(draft.body.x));
    dragState.draftEl.setAttribute("y", mmToPx(draft.body.y));
    dragState.draftEl.setAttribute("width", mmToPx(draft.body.w));
    dragState.draftEl.setAttribute("height", mmToPx(draft.body.d));
    dragState.cells = draft.cells;
    dragState.body = draft.body;
  } else if (dragState.kind === "path-paint" || dragState.kind === "path-extend") {
    const { cx, cy } = pointToCell(p);
    if (cx < 0 || cy < 0) return;
    const b = state.project.buckets.find((x) => x.id === dragState.bucketId);
    if (!b) return;
    const set = bucketCellSet(b);
    if (set.has(cellKey(cx, cy))) return;
    // Don't paint into a cell already owned by another bucket (avoid overlap).
    const owner = bucketAtCell(cx, cy);
    if (owner && owner.id !== b.id) return;
    b.cells_xy.push([cx, cy]);
    recomputeBoundsFromCells(b, cell);
    render();
  } else if (dragState.kind === "move-bucket") {
    const dx = p.x - dragState.startX;
    const dy = p.y - dragState.startY;
    const dxCells = Math.round(dx / cell);
    const dyCells = Math.round(dy / cell);
    const targetDx = dxCells - dragState.appliedDx;
    const targetDy = dyCells - dragState.appliedDy;
    if (targetDx === 0 && targetDy === 0) return;
    const b = state.project.buckets.find((x) => x.id === dragState.bucketId);
    if (!b) return;
    translateBucketCells(b, targetDx, targetDy, cell);
    dragState.appliedDx = dxCells;
    dragState.appliedDy = dyCells;
    render();
  } else if (dragState.kind === "erase-drag") {
    const { cx, cy } = pointToCell(p);
    const key = cellKey(cx, cy);
    if (dragState.lastKey === key) return;
    dragState.lastKey = key;
    eraseCellAt(cx, cy);
  }
});

window.addEventListener("mouseup", () => {
  if (!dragState) return;
  if (dragState.kind === "box-draw" && dragState.cells) {
    snapshot();
    const cell = state.project.grid.cell_mm;
    const c = dragState.cells;
    const body = dragState.body || { x: c.x * cell, y: c.y * cell, w: c.w * cell, d: c.d * cell };
    const id = `bucket-${Date.now()}`;
    const b = defaultBucket(id, c, body, state.project.defaults);
    state.project.buckets.push(b);
    selectBucket(id);
  }
  if (dragState.draftEl) dragState.draftEl.remove();
  dragState = null;
  render();
});

function onBucketCellMouseDown(e, b, cx, cy) {
  e.stopPropagation();
  const cell = state.project.grid.cell_mm;
  if (state.tool === "erase") {
    snapshot();
    eraseCellAt(cx, cy);
    dragState = { kind: "erase-drag", lastKey: cellKey(cx, cy) };
    return;
  }
  selectBucket(b.id);
  if (state.tool === "path") {
    snapshot();
    dragState = { kind: "path-extend", bucketId: b.id };
  }
  render();
}

function onMoveHandleMouseDown(e, b) {
  e.stopPropagation();
  selectBucket(b.id);
  snapshot();
  const p = svgPoint(e);
  dragState = {
    kind: "move-bucket",
    bucketId: b.id,
    startX: p.x, startY: p.y,
    appliedDx: 0, appliedDy: 0,
  };
  render();
}

function eraseCellAt(cx, cy) {
  const cell = state.project.grid.cell_mm;
  const owner = bucketAtCell(cx, cy);
  if (!owner) return;
  owner.cells_xy = owner.cells_xy.filter(([x, y]) => !(x === cx && y === cy));
  if (owner.cells_xy.length === 0) {
    state.project.buckets = state.project.buckets.filter((x) => x.id !== owner.id);
    if (state.selectedId === owner.id) selectBucket(null);
  } else {
    recomputeBoundsFromCells(owner, cell);
  }
  render();
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

// Base bbox edits move/resize the polyomino: x/y translate, w/d resize the
// rectangle and replace cells_xy with a filled rectangle of the new size.
function bindBaseBbox(id, fn) {
  document.getElementById(id).addEventListener("change", (e) => {
    const b = state.project.buckets.find((x) => x.id === state.selectedId);
    if (!b) return;
    snapshot();
    const cell = state.project.grid.cell_mm;
    fn(b, +e.target.value, cell);
    render();
  });
}
bindBaseBbox("propBaseX", (b, v, cell) => translateBucketCells(b, v - b.base_cells.x, 0, cell));
bindBaseBbox("propBaseY", (b, v, cell) => translateBucketCells(b, 0, v - b.base_cells.y, cell));
bindBaseBbox("propBaseW", (b, v, cell) => fillRect(b, b.base_cells.x, b.base_cells.y, Math.max(1, v), b.base_cells.d, cell));
bindBaseBbox("propBaseD", (b, v, cell) => fillRect(b, b.base_cells.x, b.base_cells.y, b.base_cells.w, Math.max(1, v), cell));

function fillRect(b, x, y, w, d, cellMm) {
  const cells = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < d; dy++) cells.push([x + dx, y + dy]);
  b.cells_xy = cells;
  recomputeBoundsFromCells(b, cellMm);
}

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

const GRIDFINITY_DEFAULTS = {
  height_mm: 42,
  wall_thickness_mm: 0.95,
  floor_thickness_mm: 0.7,
  corner_radius_mm: 3.75,
};

document.getElementById("previewStl").addEventListener("click", async () => {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) { alert("Select a bucket to preview."); return; }
  try {
    await withProgress("Rendering preview…", async () => {
      const stl = await generateBucketStl(b, state.project);
      openPreview(stl, b.name || b.id);
    });
  } catch (err) { console.error(err); alert("Preview failed: " + err.message); }
});

document.getElementById("previewAll").addEventListener("click", async () => {
  if (!state.project.buckets.length) { alert("No buckets to preview."); return; }
  try {
    await withProgress("Rendering preview...", async () => {
      const items = [];
      for (const bucket of state.project.buckets) {
        items.push({
          bytes: await generateBucketStl(bucket, state.project),
          label: bucket.name || bucket.id,
          x: bucket.body_mm.x,
          y: -bucket.body_mm.y,
          z: 0,
          mirrorY: true,
        });
      }
      openPreviewScene(items, "All buckets");
    });
  } catch (err) { console.error(err); alert("Preview all failed: " + err.message); }
});

document.getElementById("setGridfinityDefaults").addEventListener("click", () => {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) return;
  snapshot();
  const cell = state.project.grid.cell_mm;
  const clearance = state.project.grid.clearance_mm || 0;
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

document.getElementById("rotateLeft").addEventListener("click", () => rotateSelected(-1));
document.getElementById("rotateRight").addEventListener("click", () => rotateSelected(1));
document.getElementById("deleteBucket").addEventListener("click", () => {
  if (!state.selectedId) return;
  snapshot();
  state.project.buckets = state.project.buckets.filter((b) => b.id !== state.selectedId);
  selectBucket(null);
  render();
});

function rotateSelected(dir) {
  const b = state.project.buckets.find((x) => x.id === state.selectedId);
  if (!b) return;
  snapshot();
  rotateBucketCells90(b, state.project.grid.cell_mm, dir);
  syncPropsPanel();
  render();
}

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
bindNumberInput("drawerH", (v) => (state.project.drawer.height_mm = v));
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

async function renderBucketAll(bucket) {
  let parts = [bucket];
  if (bucket.split && bucket.split.enabled && bucket.split.strategy === "naive") {
    parts = naiveSplitBucket(bucket, state.project);
  }
  const out = [];
  for (const p of parts) {
    const stl = await generateBucketStl(p, state.project);
    const filename = parts.length === 1 ? `${p.id}.stl` : `${bucket.id}/${p.id}.stl`;
    out.push({ name: filename, bytes: stl });
  }
  return out;
}

function setStatus(text, kind) {
  const el = document.getElementById("status");
  if (!el) return;
  if (!text) { el.classList.remove("visible", "busy", "ok"); el.textContent = ""; return; }
  el.textContent = text;
  el.className = "visible " + (kind || "busy");
}

async function withProgress(label, fn) {
  const btn = document.activeElement;
  const orig = btn && btn.textContent;
  if (btn && btn.tagName === "BUTTON") { btn.textContent = label; btn.disabled = true; }
  setStatus(label, "busy");
  try {
    const result = await fn();
    setStatus("Done", "ok");
    setTimeout(() => setStatus(""), 1800);
    return result;
  } catch (err) {
    setStatus("");
    throw err;
  } finally {
    if (btn && btn.tagName === "BUTTON") { btn.textContent = orig; btn.disabled = false; }
  }
}

document.getElementById("exportStl").addEventListener("click", async () => {
  if (!state.project.buckets.length) { alert("No buckets to export."); return; }
  const ids = state.selectedId
    ? [state.selectedId]
    : state.project.buckets.map((b) => b.id);
  try {
    await withProgress("Rendering…", async () => {
      const exports = [];
      for (const id of ids) {
        const b = state.project.buckets.find((x) => x.id === id);
        if (b) exports.push(...(await renderBucketAll(b)));
      }
      if (exports.length === 1) {
        triggerDownload(new Blob([exports[0].bytes], { type: "model/stl" }), exports[0].name);
      } else {
        const zip = new JSZip();
        for (const e of exports) zip.file(e.name, e.bytes);
        triggerDownload(await zip.generateAsync({ type: "blob" }), "buckets.zip");
      }
    });
  } catch (err) { console.error(err); alert("Export failed: " + err.message); }
});

document.getElementById("exportBaseplate").addEventListener("click", async () => {
  try {
    await withProgress("Rendering baseplate…", async () => {
      const cell = state.project.grid.cell_mm;
      const gridW = Math.floor(state.project.drawer.width_mm / cell);
      const gridD = Math.floor(state.project.drawer.depth_mm / cell);
      if (gridW <= 0 || gridD <= 0) { alert("Drawer too small for any baseplate cell"); return; }

      const xSpans = balancedBaseplateAxisCells(gridW, state.project.printer.bed_x_mm, cell);
      const ySpans = balancedBaseplateAxisCells(gridD, state.project.printer.bed_y_mm, cell);

      const shapeCounts = new Map();
      for (const tileD of ySpans) {
        for (const tileW of xSpans) {
          const key = `${tileW}x${tileD}`;
          shapeCounts.set(key, { tileW, tileD, count: (shapeCounts.get(key)?.count || 0) + 1 });
        }
      }
      const shapes = [...shapeCounts.values()].sort((a, b) => (b.tileW * b.tileD) - (a.tileW * a.tileD) || a.tileW - b.tileW || a.tileD - b.tileD);
      const exports = [];
      for (const shape of shapes) {
        const stl = await generateBaseplateStl(state.project, {
          gridW: shape.tileW, gridD: shape.tileD,
          stylePlate: 0, styleHole: 0, enableMagnet: false,
        });
        for (let i = 1; i <= shape.count; i++) {
          const single = shapes.length === 1 && shape.count === 1;
          const name = single ? "baseplate.stl" : `baseplate-${shape.tileW}x${shape.tileD}-copy-${String(i).padStart(3, "0")}.stl`;
          exports.push({ name, bytes: stl });
        }
      }
      if (exports.length === 1) {
        triggerDownload(new Blob([exports[0].bytes], { type: "model/stl" }), exports[0].name);
      } else {
        const zip = new JSZip();
        for (const e of exports) zip.file(e.name, e.bytes);
        triggerDownload(await zip.generateAsync({ type: "blob" }), "baseplate.zip");
      }
    });
  } catch (err) { console.error(err); alert("Baseplate export failed: " + err.message); }
});

document.getElementById("exportBundle").addEventListener("click", async () => {
  try {
    await withProgress("Rendering bundle…", async () => {
      const zip = new JSZip();
      zip.file("project.json", JSON.stringify(state.project, null, 2));
      for (const b of state.project.buckets) {
        for (const e of await renderBucketAll(b)) {
          zip.file(`stl/${b.id}/${e.name.replace(/^[^/]+\//, "")}`, e.bytes);
        }
      }
      triggerDownload(await zip.generateAsync({ type: "blob" }), "gridfinity-project.zip");
    });
  } catch (err) { console.error(err); alert("Export failed: " + err.message); }
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
    hydrateAllBuckets();
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
  document.getElementById("drawerH").value = state.project.drawer.height_mm ?? 80;
  document.getElementById("gridSize").value = state.project.grid.cell_mm;
  document.getElementById("bedX").value = state.project.printer.bed_x_mm;
  document.getElementById("bedY").value = state.project.printer.bed_y_mm;
}

function selectTool(tool) {
  document.querySelectorAll("#tools button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === tool));
  state.tool = tool;
  render();
}

// Mouse-wheel rotates the selected bucket (90° per notch). Only when the
// cursor is over the canvas and a bucket is selected; otherwise pass through.
editor.addEventListener("wheel", (e) => {
  if (!state.selectedId) return;
  e.preventDefault();
  rotateSelected(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (e.key === "Delete" || e.key === "Backspace") {
    if (state.selectedId) {
      snapshot();
      state.project.buckets = state.project.buckets.filter((b) => b.id !== state.selectedId);
      selectBucket(null);
      render();
    }
  } else if (e.key === "ArrowLeft" && state.selectedId) { e.preventDefault(); rotateSelected(-1); }
  else if (e.key === "ArrowRight" && state.selectedId) { e.preventDefault(); rotateSelected(1); }
  else if (e.key === "b" || e.key === "B") { selectTool("box"); }
  else if (e.key === "p" || e.key === "P") { selectTool("path"); }
  else if (e.key === "e" || e.key === "E") { selectTool("erase"); }
});

hydrateAllBuckets();
render();
