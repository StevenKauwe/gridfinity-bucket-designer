// Plain JS schema helpers — no validation library, just defaults + clones.
// Mirrors backend/models.py.

// Canonical Gridfinity bin parameters (per https://gridfinity.xyz/specification):
//   height = 7mm units, 6u = 42mm is the standard bin
//   wall = 0.95mm (kennetek d_wall, 2 perimeters @ 0.4mm extrusion)
//   floor above foot ≈ 0.7mm
//   outer corner radius = 3.75mm (matches the 7.5mm cell corner)
export const GRIDFINITY_DEFAULTS = {
  height_mm: 42,
  wall_thickness_mm: 0.95,
  floor_thickness_mm: 0.7,
  corner_radius_mm: 3.75,
};

export function defaultProject() {
  return {
    version: "0.1.0",
    drawer: { width_mm: 500, depth_mm: 420, height_mm: 80 },
    grid: { cell_mm: 42, clearance_mm: 0.25, origin_x_mm: 0, origin_y_mm: 0 },
    printer: { bed_x_mm: 256, bed_y_mm: 256, bed_z_mm: 256 },
    defaults: {
      wall_thickness_mm: GRIDFINITY_DEFAULTS.wall_thickness_mm,
      floor_thickness_mm: GRIDFINITY_DEFAULTS.floor_thickness_mm,
      corner_radius_mm: GRIDFINITY_DEFAULTS.corner_radius_mm,
      bucket_height_mm: GRIDFINITY_DEFAULTS.height_mm,
    },
    buckets: [],
  };
}

export function defaultBucket(id, base_cells, body_mm, defaults) {
  defaults = defaults || {};
  // Polyomino: every bucket carries a list of base cells it occupies. Default
  // is the full filled rectangle implied by base_cells.
  const cells_xy = [];
  for (let dx = 0; dx < base_cells.w; dx++) {
    for (let dy = 0; dy < base_cells.d; dy++) {
      cells_xy.push([base_cells.x + dx, base_cells.y + dy]);
    }
  }
  return {
    id,
    name: id,
    cells_xy,
    base_cells: { ...base_cells },
    body_mm: { ...body_mm },
    height_mm: defaults.bucket_height_mm ?? GRIDFINITY_DEFAULTS.height_mm,
    wall_thickness_mm: defaults.wall_thickness_mm ?? GRIDFINITY_DEFAULTS.wall_thickness_mm,
    floor_thickness_mm: defaults.floor_thickness_mm ?? GRIDFINITY_DEFAULTS.floor_thickness_mm,
    corner_radius_mm: defaults.corner_radius_mm ?? GRIDFINITY_DEFAULTS.corner_radius_mm,
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
    parent_body_mm: null,
    parent_base_cells: null,
    cut_box_mm: null,
  };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

// ────────── Polyomino helpers ──────────

export function cellKey(x, y) { return `${x},${y}`; }

export function bucketCellSet(b) {
  const s = new Set();
  for (const [x, y] of b.cells_xy || []) s.add(cellKey(x, y));
  return s;
}

export function isCellsRectangular(b) {
  const cells = b.cells_xy || [];
  if (cells.length === 0) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const w = maxX - minX + 1;
  const d = maxY - minY + 1;
  return cells.length === w * d;
}

// Hydrate an old-format bucket (no cells_xy) from its base_cells rectangle.
// In-place. Safe to call repeatedly.
export function hydrateBucketCells(b) {
  if (Array.isArray(b.cells_xy) && b.cells_xy.length > 0) return b;
  const base = b.base_cells;
  const cells = [];
  for (let dx = 0; dx < base.w; dx++) {
    for (let dy = 0; dy < base.d; dy++) {
      cells.push([base.x + dx, base.y + dy]);
    }
  }
  b.cells_xy = cells;
  return b;
}

// Recompute base_cells (bounding cell rect) and body_mm (= bbox * cell) from
// cells_xy. Call after any change to cells_xy. Preserves overflow only when
// preserveBody=true (used by manual body edits).
export function recomputeBoundsFromCells(b, cellMm) {
  const cells = b.cells_xy;
  if (!cells || cells.length === 0) {
    b.base_cells = { x: 0, y: 0, w: 0, d: 0 };
    b.body_mm = { x: 0, y: 0, w: 0, d: 0 };
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  b.base_cells = { x: minX, y: minY, w: maxX - minX + 1, d: maxY - minY + 1 };
  b.body_mm = {
    x: minX * cellMm, y: minY * cellMm,
    w: (maxX - minX + 1) * cellMm, d: (maxY - minY + 1) * cellMm,
  };
}

export function translateBucketCells(b, dxCells, dyCells, cellMm) {
  if (!dxCells && !dyCells) return;
  b.cells_xy = (b.cells_xy || []).map(([x, y]) => [x + dxCells, y + dyCells]);
  recomputeBoundsFromCells(b, cellMm);
}

// Rotate 90° clockwise around the bucket's bounding-box center, in cell space.
// Cells stay axis-aligned and remain on integer coordinates.
export function rotateBucketCells90(b, cellMm, dir = 1) {
  const cells = b.cells_xy || [];
  if (cells.length === 0) return;
  const base = b.base_cells;
  const cx = base.x + base.w / 2;
  const cy = base.y + base.d / 2;
  // For (x+0.5, y+0.5) coordinates of cell centers, rotate around (cx, cy).
  // Then floor back to integer cell indices.
  const rotated = cells.map(([x, y]) => {
    const px = x + 0.5 - cx;
    const py = y + 0.5 - cy;
    const [rpx, rpy] = dir > 0 ? [-py, px] : [py, -px];
    return [Math.floor(rpx + cx), Math.floor(rpy + cy)];
  });
  // Shift back so the new bbox keeps its previous min corner — rotation feels
  // anchored to the existing position rather than wandering off the grid.
  let minX = Infinity, minY = Infinity;
  for (const [x, y] of rotated) {
    if (x < minX) minX = x; if (y < minY) minY = y;
  }
  const shiftX = base.x - minX;
  const shiftY = base.y - minY;
  b.cells_xy = rotated.map(([x, y]) => [x + shiftX, y + shiftY]);
  recomputeBoundsFromCells(b, cellMm);
}
