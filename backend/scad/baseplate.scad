// Wraps kennetek/gridfinity-rebuilt-openscad's baseplate builder.
//
// Builds the FULL baseplate then optionally clips with an axis-aligned cut
// box so a too-large baseplate can be split into build-plate-sized chunks.
// Output is translated so the cut piece's bottom-left sits at (0,0).

include <../../vendor/gridfinity-rebuilt-openscad/src/core/standard.scad>
use <../../vendor/gridfinity-rebuilt-openscad/gridfinity-rebuilt-baseplate.scad>
use <../../vendor/gridfinity-rebuilt-openscad/src/core/gridfinity-rebuilt-holes.scad>

$fa = 8;
$fs = 0.25;

/* [Grid] */
gridx = 1;
gridy = 1;
cell_mm = 42;

/* [Style] */
// 0=thin, 1=weighted, 2=skeletonized, 3=screw-together, 4=screw-together-minimal
style_plate = 0;
// Hole style for fastening to the drawer: 0=none, 1=countersink, 2=counterbore
style_hole = 0;

/* [Magnet holes] */
enable_magnet = false;
crush_ribs = true;
chamfer_holes = true;

/* [Cut box (for split parts; defaults = no clipping)] */
cut_x0 = 0;
cut_y0 = 0;
cut_x1 = -1;  // <0 means use gridx*cell_mm
cut_y1 = -1;  // <0 means use gridy*cell_mm

hole_options = bundle_hole_options(
    refined_hole = false,
    magnet_hole = enable_magnet,
    screw_hole = false,
    crush_ribs = crush_ribs,
    chamfer = chamfer_holes,
    supportless = false
);

body_w = gridx * cell_mm;
body_d = gridy * cell_mm;

clip_x1 = (cut_x1 < 0) ? body_w : cut_x1;
clip_y1 = (cut_y1 < 0) ? body_d : cut_y1;
clip_w = clip_x1 - cut_x0;
clip_d = clip_y1 - cut_y0;

module full_baseplate() {
    translate([body_w / 2, body_d / 2, 0])
        gridfinityBaseplate(
            [gridx, gridy], cell_mm, [0, 0],
            style_plate, hole_options, style_hole, [0, 0]
        );
}

translate([-cut_x0, -cut_y0, 0])
intersection() {
    full_baseplate();
    translate([cut_x0, cut_y0, -1])
        cube([clip_w, clip_d, 100]);
}
