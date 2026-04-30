"""Simple STL generator for rectangular Gridfinity buckets.

MVP geometry:
  - Body: hollow rectangular shell at body_mm position, sitting on z=0
  - Base: one Gridfinity-style stepped foot per base cell, below z=0
"""
from __future__ import annotations

import io

import numpy as np
from stl import mesh

from .models import Bucket, Project

# Gridfinity foot profile (simplified two-step approximation).
# Top of foot at z=0; foot height ~5 mm.
FOOT_TOP_SIZE = 41.5  # mm (per cell, with 0.25 clearance from 42 cell)
FOOT_MID_Z = -2.6
FOOT_MID_SIZE = 37.2
FOOT_BOTTOM_Z = -4.75
FOOT_BOTTOM_SIZE = 35.6


def _box_faces(
    x0: float, y0: float, z0: float, x1: float, y1: float, z1: float,
    omit: set[str] | None = None, flip: bool = False,
) -> list[np.ndarray]:
    """Return triangles (Nx3x3) for an axis-aligned box.

    omit: set of face names to skip {"bottom","top","x0","x1","y0","y1"}.
    flip: reverse winding (for cavity inner shells).
    """
    omit = omit or set()
    v = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    quads = {
        "bottom": (0, 3, 2, 1),  # normal -z
        "top":    (4, 5, 6, 7),  # normal +z
        "y0":     (0, 1, 5, 4),  # normal -y
        "x1":     (1, 2, 6, 5),  # normal +x
        "y1":     (2, 3, 7, 6),  # normal +y
        "x0":     (3, 0, 4, 7),  # normal -x
    }
    tris: list[np.ndarray] = []
    for name, (a, b, c, d) in quads.items():
        if name in omit:
            continue
        q = [v[a], v[b], v[c], v[d]]
        if flip:
            q = list(reversed(q))
        tris.append(np.array([q[0], q[1], q[2]]))
        tris.append(np.array([q[0], q[2], q[3]]))
    return tris


def _annulus_top(
    ox0: float, oy0: float, ox1: float, oy1: float,
    ix0: float, iy0: float, ix1: float, iy1: float, z: float,
) -> list[np.ndarray]:
    """Top annulus connecting outer rect (ox*) to inner hole (ix*) at height z.

    Normals point +z.
    """
    o = [(ox0, oy0, z), (ox1, oy0, z), (ox1, oy1, z), (ox0, oy1, z)]
    i = [(ix0, iy0, z), (ix1, iy0, z), (ix1, iy1, z), (ix0, iy1, z)]
    tris: list[np.ndarray] = []
    for k in range(4):
        a, b = o[k], o[(k + 1) % 4]
        c, d = i[(k + 1) % 4], i[k]
        tris.append(np.array([a, b, c]))
        tris.append(np.array([a, c, d]))
    return tris


def _foot_mesh(cx: float, cy: float, x_offset: float = 0.0, y_offset: float = 0.0) -> list[np.ndarray]:
    """Stepped pyramidal foot centered at (cx, cy), top at z=0."""
    cx -= x_offset
    cy -= y_offset
    tris: list[np.ndarray] = []
    # Top block: FOOT_TOP -> FOOT_MID
    tx0, tx1 = cx - FOOT_TOP_SIZE / 2, cx + FOOT_TOP_SIZE / 2
    ty0, ty1 = cy - FOOT_TOP_SIZE / 2, cy + FOOT_TOP_SIZE / 2
    mx0, mx1 = cx - FOOT_MID_SIZE / 2, cx + FOOT_MID_SIZE / 2
    my0, my1 = cy - FOOT_MID_SIZE / 2, cy + FOOT_MID_SIZE / 2
    bx0, bx1 = cx - FOOT_BOTTOM_SIZE / 2, cx + FOOT_BOTTOM_SIZE / 2
    by0, by1 = cy - FOOT_BOTTOM_SIZE / 2, cy + FOOT_BOTTOM_SIZE / 2

    # Top rim (z=0): annular cap from outer top to itself (full square top, closed since body sits here)
    tris += _box_faces(tx0, ty0, FOOT_MID_Z, tx1, ty1, 0.0, omit=set())
    # Mid block (rectangular core)
    tris += _box_faces(mx0, my0, FOOT_BOTTOM_Z, mx1, my1, FOOT_MID_Z, omit={"top"})
    # Bottom block under mid
    tris += _box_faces(bx0, by0, FOOT_BOTTOM_Z - 0.01, bx1, by1, FOOT_BOTTOM_Z, omit={"top"})
    return tris


def _bucket_export_origin(bucket: Bucket, project: Project) -> tuple[float, float]:
    """Return a stable XY origin for one printable bucket export.

    Project coordinates are drawer coordinates. STL exports should be local to
    the printed part so slicers do not receive a model hundreds of millimeters
    away from the build plate origin.
    """
    cell = project.grid.cell_mm
    base_x = bucket.base_cells.x * cell
    base_y = bucket.base_cells.y * cell
    return min(bucket.body_mm.x, base_x), min(bucket.body_mm.y, base_y)


def _bucket_triangles(bucket: Bucket, project: Project) -> np.ndarray:
    cell = project.grid.cell_mm
    x_offset, y_offset = _bucket_export_origin(bucket, project)
    bx = bucket.body_mm.x - x_offset
    by = bucket.body_mm.y - y_offset
    bw, bd = bucket.body_mm.w, bucket.body_mm.d
    h = bucket.height_mm
    wt = bucket.wall_thickness_mm
    ft = bucket.floor_thickness_mm

    tris: list[np.ndarray] = []

    # Outer body: keep bottom and 4 sides; top is replaced by annulus
    tris += _box_faces(bx, by, 0.0, bx + bw, by + bd, h, omit={"top"})

    # Inner cavity (flipped) — sits on floor (z = ft) up to top (z = h)
    ix0 = bx + wt
    iy0 = by + wt
    ix1 = bx + bw - wt
    iy1 = by + bd - wt
    if ix1 > ix0 and iy1 > iy0 and h > ft:
        tris += _box_faces(ix0, iy0, ft, ix1, iy1, h, omit={"top"}, flip=True)
        # Top annulus
        tris += _annulus_top(bx, by, bx + bw, by + bd, ix0, iy0, ix1, iy1, h)

    # Base feet — one per grid cell within base_cells
    bcx = bucket.base_cells.x
    bcy = bucket.base_cells.y
    for i in range(bucket.base_cells.w):
        for j in range(bucket.base_cells.d):
            cx = (bcx + i) * cell + cell / 2
            cy = (bcy + j) * cell + cell / 2
            tris += _foot_mesh(cx, cy, x_offset, y_offset)

    return np.array(tris)


def generate_stl_bytes(bucket: Bucket, project: Project) -> bytes:
    triangles = _bucket_triangles(bucket, project)
    data = np.zeros(len(triangles), dtype=mesh.Mesh.dtype)
    for k, tri in enumerate(triangles):
        data["vectors"][k] = tri
    m = mesh.Mesh(data)
    buf = io.BytesIO()
    from stl.stl import Mode
    m.save(f"{bucket.id}.stl", fh=buf, mode=Mode.BINARY)
    return buf.getvalue()
