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
  return {
    id,
    name: id,
    base_cells: { ...base_cells },
    body_mm: { ...body_mm },
    height_mm: defaults.bucket_height_mm ?? GRIDFINITY_DEFAULTS.height_mm,
    wall_thickness_mm: defaults.wall_thickness_mm ?? GRIDFINITY_DEFAULTS.wall_thickness_mm,
    floor_thickness_mm: defaults.floor_thickness_mm ?? GRIDFINITY_DEFAULTS.floor_thickness_mm,
    corner_radius_mm: defaults.corner_radius_mm ?? GRIDFINITY_DEFAULTS.corner_radius_mm,
    label: { enabled: false, text: "", style: "front-scoop" },
    dividers: [],
    connectors: { enabled: false, type: "none" },
    split: { enabled: false, strategy: "auto", parts: [] },
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
