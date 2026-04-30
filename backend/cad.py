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

# Kennetek's gridz_define mode 3 = "External mm" (height parameter is total
# bin height in mm including the foot, excluding the stacking lip).
GRIDZ_DEFINE_EXTERNAL_MM = 3


def _effective_geometry(bucket: Bucket) -> tuple:
    """Resolve geometry to render.

    For non-split buckets: bucket's own body + base, no parent cut_box.
    For split parts: parent (un-split) body + base, plus part's cut_box in
    parent-body-local coords.
    """
    if bucket.cut_box_mm is not None and bucket.parent_body_mm is not None:
        body = bucket.parent_body_mm
        base = bucket.parent_base_cells or bucket.base_cells
        return body, base, bucket.cut_box_mm
    return bucket.body_mm, bucket.base_cells, None


def _bounding_grid_and_cut(bucket: Bucket, project: Project) -> tuple[int, int, list[float]]:
    """Compute the smallest integer-cell grid containing both body and base,
    and a cut box (in bounding-grid-local mm) that selects just this bucket.

    Strategy: pad the bucket up to a cell-aligned bounding grid, render that
    as a normal kennetek bin, and let SCAD intersect with the cut box to
    trim back to the actual body extent. Overflow buckets become sliced
    standard bins — partial feet on overflow edges, no special geometry.
    """
    cell = project.grid.cell_mm
    body, base, cut_box = _effective_geometry(bucket)

    # Drawer-coord bounds of body and base.
    base_x0, base_y0 = base.x * cell, base.y * cell
    base_x1, base_y1 = (base.x + base.w) * cell, (base.y + base.d) * cell
    body_x0, body_y0 = body.x, body.y
    body_x1, body_y1 = body.x + body.w, body.y + body.d

    # Smallest cell-aligned grid that contains body ∪ base.
    union_x0 = min(base_x0, body_x0)
    union_y0 = min(base_y0, body_y0)
    union_x1 = max(base_x1, body_x1)
    union_y1 = max(base_y1, body_y1)
    bgx0 = math.floor(union_x0 / cell) * cell
    bgy0 = math.floor(union_y0 / cell) * cell
    bgx1 = math.ceil(union_x1 / cell) * cell
    bgy1 = math.ceil(union_y1 / cell) * cell
    grid_w = round((bgx1 - bgx0) / cell)
    grid_d = round((bgy1 - bgy0) / cell)

    if cut_box is None:
        # Slice down to the body extent.
        cut = [body_x0 - bgx0, body_y0 - bgy0, body_x1 - bgx0, body_y1 - bgy0]
    else:
        # Split part: cut_box is in parent-body-local coords; shift to
        # bounding-grid-local coords.
        cut = [
            body_x0 + cut_box[0] - bgx0,
            body_y0 + cut_box[1] - bgy0,
            body_x0 + cut_box[2] - bgx0,
            body_y0 + cut_box[3] - bgy0,
        ]
    return grid_w, grid_d, cut


def _standard_params(bucket: Bucket, project: Project, grid_w: int, grid_d: int, cut_box: list[float]) -> dict:
    """Parameter overrides for backend/scad/standard.scad."""
    return {
        "gridx": int(grid_w),
        "gridy": int(grid_d),
        "gridz": float(bucket.height_mm),
        "gridz_define": GRIDZ_DEFINE_EXTERNAL_MM,
        "enable_zsnap": False,
        "include_lip": bucket.include_lip,
        "magnet_holes": bucket.magnet_holes,
        "screw_holes": bucket.screw_holes,
        "only_corners": bucket.only_corners_holes,
        "scoop": float(bucket.scoop),
        "style_tab": int(bucket.style_tab),
        "divx": 1,
        "divy": 1,
        "refined_holes": False,
        "cell_mm": float(project.grid.cell_mm),
        "cut_x0": float(cut_box[0]),
        "cut_y0": float(cut_box[1]),
        "cut_x1": float(cut_box[2]),
        "cut_y1": float(cut_box[3]),
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

    grid_w, grid_d, cut_box = _bounding_grid_and_cut(bucket, project)
    try:
        return render_stl(
            STANDARD_SCAD, _standard_params(bucket, project, grid_w, grid_d, cut_box),
        )
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
