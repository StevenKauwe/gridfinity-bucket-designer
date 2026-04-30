// Wraps kennetek/gridfinity-rebuilt-openscad's bin builder.
//
// Builds the FULL bin once, optionally clipping it with an axis-aligned cut
// box for split parts. Output is translated so the cut piece's bottom-left
// sits at (0,0).
//
// Coords (in body-local, before clipping):
//   (0,0)   bottom-left of body
//   (gridx*cell_mm, gridy*cell_mm)  top-right
//
// cut_x0..cut_x1, cut_y0..cut_y1 default to the full body — no clipping.

include <../../vendor/gridfinity-rebuilt-openscad/src/core/standard.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-utility.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-holes.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/bin.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/cutouts.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/helpers/generic-helpers.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/helpers/grid.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/helpers/grid_element.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/wall.scad>

$fa = 4;
$fs = 0.25;

/* [Grid] */
gridx = 1;
gridy = 1;
gridz = 42;
gridz_define = 3; // 3 = External mm including lip
enable_zsnap = false;
include_lip = true;

/* [Compartments] */
divx = 1;
divy = 1;
depth = 0;
style_tab = 5;
place_tab = 0;
scoop = 1;
cut_cylinders = false;
cd = 10;
c_chamfer = 0.5;

/* [Holes] */
only_corners = false;
refined_holes = false;
magnet_holes = false;
screw_holes = false;
crush_ribs = true;
chamfer_holes = true;
printable_hole_top = true;
enable_thumbscrew = false;

cell_mm = 42;

/* [Cut box (for split parts and overflow trim; defaults = no clipping)] */
cut_x0 = 0;
cut_y0 = 0;
cut_x1 = -1;  // <0 means use gridx*cell_mm
cut_y1 = -1;  // <0 means use gridy*cell_mm
// Wall thickness used for the seal slabs that close the cavity at any cut
// face. Two perimeters of 0.4mm extrusion ≈ 0.95 (kennetek's d_wall).
seal_wall_thickness = 0.95;
// Per-face seal toggles: true = close cavity with a wall (overhang/body
// boundary), false = leave cut open so a sibling split part can mate
// cleanly with one continuous interior. The dispatcher decides.
seal_x0 = true;
seal_y0 = true;
seal_x1 = true;
seal_y1 = true;

hole_options = bundle_hole_options(
    refined_hole = refined_holes,
    magnet_hole = magnet_holes,
    screw_hole = screw_holes,
    crush_ribs = crush_ribs,
    chamfer = chamfer_holes,
    supportless = printable_hole_top
);

bin1 = new_bin(
    grid_size = [gridx, gridy],
    height_mm = height(gridz, gridz_define, enable_zsnap),
    fill_height = 0,
    include_lip = include_lip,
    hole_options = hole_options,
    only_corners = only_corners,
    thumbscrew = enable_thumbscrew,
    grid_dimensions = [cell_mm, cell_mm]
);

body_w = gridx * cell_mm;
body_d = gridy * cell_mm;

clip_x1 = (cut_x1 < 0) ? body_w : cut_x1;
clip_y1 = (cut_y1 < 0) ? body_d : cut_y1;
clip_w = clip_x1 - cut_x0;
clip_d = clip_y1 - cut_y0;

// `cut_needed` controls whether we wrap the bin in render()+intersection().
// CGAL booleans on a kennetek bin are expensive (~+100–500 ms per render),
// so for the common no-cut case we emit bin_render's three top-level outputs
// (wall, infill, foot) directly — no extra CSG.
no_cut = (cut_x0 <= 0.001)
      && (cut_y0 <= 0.001)
      && (clip_x1 >= body_w - 0.001)
      && (clip_y1 >= body_d - 0.001);

module full_bin(wrap_render=true) {
    // bin_render emits multiple top-level objects (wall, infill, foot).
    // Wrap in render() ONLY when we actually intersect with the cut box,
    // so the boolean operates on a single solid. For no-cut renders we
    // skip render() entirely — bin_render's outputs union implicitly when
    // emitted side by side.
    if (wrap_render) {
        render()
        translate([body_w / 2, body_d / 2, 0])
        bin_render(bin1) {
            bin_subdivide(bin1, [divx, divy]) {
                if (cut_cylinders) {
                    cut_chamfered_cylinder(cd / 2, cgs(height=depth).z, c_chamfer);
                } else {
                    cut_compartment_auto(cgs(height=depth), style_tab, place_tab != 0, scoop);
                }
            }
        }
    } else {
        translate([body_w / 2, body_d / 2, 0])
        bin_render(bin1) {
            bin_subdivide(bin1, [divx, divy]) {
                if (cut_cylinders) {
                    cut_chamfered_cylinder(cd / 2, cgs(height=depth).z, c_chamfer);
                } else {
                    cut_compartment_auto(cgs(height=depth), style_tab, place_tab != 0, scoop);
                }
            }
        }
    }
}

// Total bin height = wall height + stacking lip (if enabled). Slabs need to
// cover the lip region too — when the cut is inside the bin, the cut plane
// passes through the lip and the slab must seal it.
slab_h = height(gridz, gridz_define, enable_zsnap)
       + (include_lip ? stacking_lip_height() : 0);

eps = 0.001;
left_cut  = cut_x0 > eps;
right_cut = clip_x1 < body_w - eps;
front_cut = cut_y0 > eps;
back_cut  = clip_y1 < body_d - eps;

// Clamp slab perpendicular extents to the bin's natural outer rect (kennetek
// insets cell boundaries by BASE_GAP_MM/2 = 0.25mm) so the slab does not
// stick out past the bin profile.
gap = BASE_GAP_MM[0] / 2;
slab_x_lo = max(cut_x0, gap);
slab_x_hi = min(clip_x1, body_w - gap);
slab_y_lo = max(cut_y0, gap);
slab_y_hi = min(clip_y1, body_d - gap);

// Seal slabs: thin walls placed inside the bin at each cut face so the
// cavity does not get exposed when intersection() trims the bounding-grid
// extension. Combined with the bin's own outer-wall geometry this gives a
// continuous wall along every body edge — the cut becomes a normal wall,
// not an open hole into the cavity.
module seal_slabs() {
    if (left_cut  && seal_x0)
        translate([cut_x0, slab_y_lo, 0])
            cube([seal_wall_thickness, slab_y_hi - slab_y_lo, slab_h]);
    if (right_cut && seal_x1)
        translate([clip_x1 - seal_wall_thickness, slab_y_lo, 0])
            cube([seal_wall_thickness, slab_y_hi - slab_y_lo, slab_h]);
    if (front_cut && seal_y0)
        translate([slab_x_lo, cut_y0, 0])
            cube([slab_x_hi - slab_x_lo, seal_wall_thickness, slab_h]);
    if (back_cut  && seal_y1)
        translate([slab_x_lo, clip_y1 - seal_wall_thickness, 0])
            cube([slab_x_hi - slab_x_lo, seal_wall_thickness, slab_h]);
}

if (no_cut) {
    // Fast path: emit bin_render directly, no CGAL intersection.
    full_bin(wrap_render=false);
} else {
    translate([-cut_x0, -cut_y0, 0])
    intersection() {
        union() {
            full_bin();
            seal_slabs();
        }
        translate([cut_x0, cut_y0, -1])
            cube([clip_w, clip_d, slab_h + 100]);
    }
}
