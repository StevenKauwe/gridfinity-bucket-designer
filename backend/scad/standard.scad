// Render a kennetek-style Gridfinity bin sized to a fractional-cell body.
//
// Walls + stacking lip come from kennetek's render_wall(body_size), so the
// outer profile, lip, and wall thickness match exactly what kennetek would
// produce for an integer-cell bin of the same outline. The interior cavity
// uses kennetek's compartment_cutter (rounded with r_f2 fillet at the
// wall-floor joint) so every inner edge — including any cut-plane edge —
// has the same fillet as the rest of the bin.
//
// Foot pattern is positioned at the user's base cells via gridfinityBase
// (independent from body extent, so a body can overhang past the base).
//
// Inter-part split seams subtract a thin slab on the seam side, removing
// the wall + lip + a sliver of infill so adjacent parts share a continuous
// interior cavity when assembled.

include <../../vendor/gridfinity-rebuilt-openscad/src/core/standard.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/base.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/wall.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/cutouts.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-holes.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/helpers/shapes.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/helpers/generic-helpers.scad>

$fa = 4;
$fs = 0.25;

/* [Body] */
// Body extent in mm — the bin's outer footprint.
body_w = 84;
body_d = 42;
// Total external bin height (foot + body + lip).
body_h = 42;

/* [Base] */
// User-selected base cells. These keep the export aligned to the layout grid.
base_grid_w = 2;
base_grid_d = 1;
base_offset_x = 0;
base_offset_y = 0;
// Grid-aligned cover footprint used for the lower base. It may include partial
// cells outside base_grid_* when the body extends fractionally past the base.
foot_grid_w = 2;
foot_grid_d = 1;
foot_offset_x = 0;
foot_offset_y = 0;
cell_mm = 42;

/* [Compartment] */
// scoop is currently the only compartment option exposed; tabs require a
// grid_element context that we don't establish for fractional bins.
scoop = 0;

/* [Gridfinity options] */
include_lip = true;
magnet_holes = false;
screw_holes = false;
only_corners = false;
refined_holes = false;
crush_ribs = true;
chamfer_holes = true;
printable_hole_top = true;

/* [Split seams] */
// Subtract the wall on these sides — used by naive split parts so adjacent
// pieces mate cleanly with one continuous interior. False on every side
// for a normal bucket.
seam_x0 = false;
seam_x1 = false;
seam_y0 = false;
seam_y1 = false;

hole_options = bundle_hole_options(
    refined_hole = refined_holes,
    magnet_hole = magnet_holes,
    screw_hole = screw_holes,
    crush_ribs = crush_ribs,
    chamfer = chamfer_holes,
    supportless = printable_hole_top
);

// `body_h` is the total external height. Kennetek's wall height excludes both
// the base and the stacking lip because render_wall adds the lip itself.
bin_h = max(BASE_HEIGHT, body_h - (include_lip ? stacking_lip_height() : 0));
wall_h = max(0, bin_h - BASE_HEIGHT);
// Match new_bin(): with a lip, keep the stacking-lip support area solid.
infill_h = max(0, include_lip
    ? bin_h - BASE_HEIGHT - STACKING_LIP_SUPPORT_HEIGHT
    : bin_h - BASE_HEIGHT);

module _foot() {
    foot_total_w = foot_grid_w * cell_mm;
    foot_total_d = foot_grid_d * cell_mm;

    intersection() {
        translate([foot_offset_x + foot_total_w / 2,
                   foot_offset_y + foot_total_d / 2, 0])
            gridfinityBase(
                grid_size = [foot_grid_w, foot_grid_d],
                grid_dimensions = [cell_mm, cell_mm],
                hole_options = hole_options,
                only_corners = only_corners
            );

        translate([body_w / 2, body_d / 2, -TOLLERANCE])
            linear_extrude(BASE_HEIGHT + 2 * TOLLERANCE)
                rounded_square(
                    [body_w - TOLLERANCE, body_d - TOLLERANCE],
                    BASE_TOP_RADIUS, center=true);
    }
}

module _infill() {
    // Same infill block kennetek's bin_render_infill() creates.
    if (infill_h > 0) {
        translate([body_w / 2, body_d / 2, BASE_HEIGHT])
        linear_extrude(infill_h)
            rounded_square(
                [body_w - TOLLERANCE, body_d - TOLLERANCE],
                BASE_TOP_RADIUS, center=true);
    }
}

module _wall_ring() {
    translate([body_w / 2, body_d / 2, BASE_HEIGHT]) {
        if (include_lip) {
            render_wall([body_w, body_d, wall_h]);
        } else {
            linear_extrude(wall_h)
                difference() {
                    rounded_square([body_w, body_d], BASE_TOP_RADIUS, center=true);
                    rounded_square([body_w, body_d] - 2 * [d_wall, d_wall], BASE_TOP_RADIUS, center=true);
                }
        }
    }
}

module _compartment_cut() {
    cut_w = body_w - 2 * d_wall;
    cut_d = body_d - 2 * d_wall;
    cut_z = infill_h;
    if (cut_w > 0 && cut_d > 0 && cut_z > 0) {
        // compartment_cutter is anchored at z=top, extends downward by size_mm.z.
        translate([body_w / 2, body_d / 2, BASE_HEIGHT + cut_z + TOLLERANCE])
            compartment_cutter([cut_w, cut_d, cut_z], scoop_percent=scoop, tab_width=0);
    }
}

module _seam_cutter() {
    // Only cut wall + lip + cavity area above z = BASE_HEIGHT. Below that
    // the foot + bridge structure stays intact so adjacent split parts butt
    // together edge-to-edge with no gap at the bottom.
    cut_z0 = BASE_HEIGHT;
    cut_z1 = body_h + 5;
    cut_depth = d_wall + STACKING_LIP_SIZE.x + 0.5;
    if (seam_x0)
        translate([0, -1, cut_z0])
            cube([cut_depth, body_d + 2, cut_z1 - cut_z0]);
    if (seam_x1)
        translate([body_w - cut_depth, -1, cut_z0])
            cube([cut_depth, body_d + 2, cut_z1 - cut_z0]);
    if (seam_y0)
        translate([-1, 0, cut_z0])
            cube([body_w + 2, cut_depth, cut_z1 - cut_z0]);
    if (seam_y1)
        translate([-1, body_d - cut_depth, cut_z0])
            cube([body_w + 2, cut_depth, cut_z1 - cut_z0]);
}

difference() {
    union() {
        _foot();
        _infill();
        _wall_ring();
    }
    _compartment_cut();
    _seam_cutter();
}
