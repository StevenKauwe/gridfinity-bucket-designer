// Custom Gridfinity bin with body footprint that may overflow the base
// footprint. Composes kennetek/gridfinity-rebuilt-openscad primitives so the
// geometry IS the same bucket as a standard kennetek bin, just with the wall
// + stackable lip continued out into the overflow region.
//
// Z convention (matches kennetek/standard.scad):
//   z = 0                              bottom of feet (build-plate contact)
//   z = BASE_HEIGHT (= 7)              top of feet / start of body floor
//   z = BASE_HEIGHT + floor_thickness  start of cavity
//   z = body_h                         top of stacking lip
//
// All parameters are file-scope so they can be overridden via OpenSCAD -D.

include <../../vendor/gridfinity-rebuilt-openscad/src/core/standard.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/base.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/wall.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-holes.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/helpers/shapes.scad>

$fa = 4;
$fs = 0.25;

/* [Body] */
body_w = 100;
body_d = 42;
body_h = 42;

/* [Base] */
base_w = 1;
base_d = 1;
base_offset_x = 0;
base_offset_y = 0;
cell_mm = 42;

/* [Walls] */
wall_thickness = 1.2;
floor_thickness = 1.2;

/* [Gridfinity Options] */
include_lip = true;
magnet_holes = false;
screw_holes = false;
refined_holes = false;
crush_ribs = true;
chamfer_holes = true;
printable_hole_top = true;
only_corners_holes = false;

/* [Cut box (for split parts; defaults = no clipping)] */
cut_x0 = 0;
cut_y0 = 0;
cut_x1 = -1;  // <0 means use body_w
cut_y1 = -1;  // <0 means use body_d

hole_options = bundle_hole_options(
    refined_hole = refined_holes,
    magnet_hole = magnet_holes,
    screw_hole = screw_holes,
    crush_ribs = crush_ribs,
    chamfer = chamfer_holes,
    supportless = printable_hole_top
);

base_w_mm = base_w * cell_mm;
base_d_mm = base_d * cell_mm;
base_center_x = base_offset_x + base_w_mm / 2;
base_center_y = base_offset_y + base_d_mm / 2;

corner_radius = BASE_TOP_RADIUS;
inner_radius = max(0.5, corner_radius - wall_thickness);

floor_z0 = BASE_HEIGHT;
floor_z1 = BASE_HEIGHT + floor_thickness;

// 2D body footprint, anchored so (0,0) sits at the body's bottom-left.
module body_outer_2d() {
    translate([body_w / 2, body_d / 2])
        rounded_square([body_w, body_d], corner_radius, center=true);
}

module body_inner_2d() {
    translate([body_w / 2, body_d / 2])
        rounded_square(
            [body_w - 2 * wall_thickness, body_d - 2 * wall_thickness],
            inner_radius, center=true
        );
}

// 2D footprint of the overflow region only (body minus base region).
module overflow_region_2d() {
    difference() {
        body_outer_2d();
        translate([base_offset_x, base_offset_y])
            square([base_w_mm, base_d_mm]);
    }
}

module base_assembly() {
    translate([base_center_x, base_center_y, 0])
        gridfinityBase(
            grid_size = [base_w, base_d],
            grid_dimensions = [cell_mm, cell_mm],
            hole_options = hole_options,
            only_corners = only_corners_holes
        );
}

// Body floor across the entire body footprint, between the foot top and the
// cavity bottom. In the overflow region this floor is cantilevered (held up
// by the perimeter wall skirt that runs from z=0 up to the floor).
module body_floor() {
    translate([0, 0, floor_z0])
        linear_extrude(floor_thickness)
            body_outer_2d();
}

// Walls + (optional) stacking lip, sized so that the bucket's total external
// height matches body_h. render_wall produces walls + lip; lip adds
// stacking_lip_height() on top of the size.z passed in.
module body_walls_and_lip() {
    lip_h = include_lip ? stacking_lip_height() : 0;
    wall_h = max(0, body_h - lip_h);
    translate([body_w / 2, body_d / 2, 0])
        render_wall([body_w, body_d, wall_h]);
}

// Inner cavity from the floor up to the top of the body.
module body_cavity() {
    translate([0, 0, floor_z1])
        linear_extrude(body_h - floor_z1 + 0.5)
            body_inner_2d();
}

module overflow_bucket() {
    difference() {
        union() {
            base_assembly();
            body_floor();
            body_walls_and_lip();
        }
        body_cavity();
    }
}

clip_x1 = (cut_x1 < 0) ? body_w : cut_x1;
clip_y1 = (cut_y1 < 0) ? body_d : cut_y1;
clip_w = clip_x1 - cut_x0;
clip_d = clip_y1 - cut_y0;

translate([-cut_x0, -cut_y0, 0])
intersection() {
    overflow_bucket();
    translate([cut_x0, cut_y0, -1])
        cube([clip_w, clip_d, body_h + 100]);
}
