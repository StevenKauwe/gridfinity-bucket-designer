"""STL generation entrypoint.

Routes each bucket to the most accurate available renderer:

1. **Standard path** — body matches base footprint exactly. Calls kennetek's
   ``gridfinity-rebuilt-bins.scad`` via OpenSCAD CLI.
2. **Overflow path** — body extends beyond base footprint. Calls our
   ``backend/scad/overflow.scad`` which composes kennetek's ``gridfinityBase``
   + ``render_wall`` primitives so the bucket geometry is identical to a
   standard bin, just with the wall+lip continuing into the overflow region.
3. **Fallback path** — OpenSCAD is not installed. Calls the hand-rolled
   triangle generator in ``backend.legacy_cad`` so the server still produces
   *something* exportable. Geometry is approximate.

Public surface preserved for tests: ``generate_stl_bytes(bucket, project)``.
"""
from __future__ import annotations

import logging
import math
from pathlib import Path

from . import legacy_cad
from .models import Bucket, Project
from .openscad import (
    OpenSCADRenderError,
    OpenSCADUnavailable,
    find_openscad,
    render_stl,
)

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
STANDARD_SCAD = REPO_ROOT / "backend" / "scad" / "standard.scad"
OVERFLOW_SCAD = REPO_ROOT / "backend" / "scad" / "overflow.scad"
BASEPLATE_SCAD = REPO_ROOT / "backend" / "scad" / "baseplate.scad"

def _render_geometry(bucket: Bucket, project: Project) -> dict:
    """Compute the params for ``standard.scad``'s fractional-bin module.

    Body: the bucket's body extent (or split part's slice). The bin renders
    walls + lip + cavity at this exact footprint via kennetek's primitives,
    so the result is geometrically a kennetek bin of the body's shape.

    Base: foot grid placed at the user's base cells, offset within the body
    so overhang regions have wall but no foot.

    Seam flags: for naive-split parts, true on sides where the part is cut
    from the parent (inter-part seam). The wall is removed there so adjacent
    pieces share a continuous interior cavity.
    """
    cell = project.grid.cell_mm
    body = bucket.body_mm
    base = bucket.base_cells

    base_offset_x = base.x * cell - body.x
    base_offset_y = base.y * cell - body.y

    seam = {"x0": False, "x1": False, "y0": False, "y1": False}
    parent = bucket.parent_body_mm
    if parent is not None:
        eps = 1e-3
        seam["x0"] = abs(body.x - parent.x) > eps
        seam["x1"] = abs((body.x + body.w) - (parent.x + parent.w)) > eps
        seam["y0"] = abs(body.y - parent.y) > eps
        seam["y1"] = abs((body.y + body.d) - (parent.y + parent.d)) > eps

    return {
        "body_w": float(body.w),
        "body_d": float(body.d),
        "body_h": float(bucket.height_mm),
        "base_grid_w": int(base.w),
        "base_grid_d": int(base.d),
        "base_offset_x": float(base_offset_x),
        "base_offset_y": float(base_offset_y),
        "cell_mm": float(cell),
        "scoop": float(bucket.scoop),
        "include_lip": bool(bucket.include_lip),
        "magnet_holes": bool(bucket.magnet_holes),
        "screw_holes": bool(bucket.screw_holes),
        "only_corners": bool(bucket.only_corners_holes),
        "refined_holes": False,
        "seam_x0": bool(seam["x0"]),
        "seam_x1": bool(seam["x1"]),
        "seam_y0": bool(seam["y0"]),
        "seam_y1": bool(seam["y1"]),
    }




def generate_stl_bytes(bucket: Bucket, project: Project) -> bytes:
    """Render a single bucket to a binary STL.

    Returns STL bytes. Raises :class:`OpenSCADRenderError` if OpenSCAD is
    available but rendering fails. If OpenSCAD is missing, falls back to the
    hand-rolled legacy renderer (logs a warning) so the server still works.
    """
    if find_openscad() is None:
        log.warning(
            "openscad not found; falling back to legacy hand-rolled CAD for bucket %s. "
            "Install OpenSCAD for spec-correct Gridfinity geometry.", bucket.id,
        )
        return legacy_cad.generate_stl_bytes(bucket, project)

    try:
        return render_stl(STANDARD_SCAD, _render_geometry(bucket, project))
    except OpenSCADUnavailable:
        return legacy_cad.generate_stl_bytes(bucket, project)


def generate_baseplate_stl(
    project: Project,
    *,
    grid_w: int,
    grid_d: int,
    cut_box: list[float] | None = None,
    style_plate: int = 0,
    style_hole: int = 0,
    enable_magnet: bool = False,
) -> bytes:
    """Render a Gridfinity baseplate of grid_w × grid_d cells.

    cut_box: [x0, y0, x1, y1] in mm to clip the baseplate (for naive split).
    """
    if find_openscad() is None:
        raise OpenSCADUnavailable(
            "openscad CLI not found; baseplate export requires OpenSCAD."
        )
    params: dict = {
        "gridx": int(grid_w),
        "gridy": int(grid_d),
        "cell_mm": float(project.grid.cell_mm),
        "style_plate": int(style_plate),
        "style_hole": int(style_hole),
        "enable_magnet": bool(enable_magnet),
    }
    if cut_box is not None:
        params.update({
            "cut_x0": float(cut_box[0]),
            "cut_y0": float(cut_box[1]),
            "cut_x1": float(cut_box[2]),
            "cut_y1": float(cut_box[3]),
        })
    return render_stl(BASEPLATE_SCAD, params)
