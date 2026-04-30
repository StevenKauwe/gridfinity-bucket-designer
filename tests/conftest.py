from __future__ import annotations

import pytest

from backend.models import Bucket, Drawer, Project, RectCells, RectMM
from backend.openscad import find_openscad


@pytest.fixture
def openscad_required() -> str:
    """Skip the test if OpenSCAD is not installed on the host."""
    binary = find_openscad()
    if not binary:
        pytest.skip("openscad CLI not available")
    return binary


def make_bucket(
    bucket_id: str = "b",
    base_x: int = 0,
    base_y: int = 0,
    base_w: int = 1,
    base_d: int = 1,
    *,
    body_x: float | None = None,
    body_y: float | None = None,
    body_w: float | None = None,
    body_d: float | None = None,
    height_mm: float = 42,
    cell: float = 42,
    **overrides,
) -> Bucket:
    bx = base_x * cell if body_x is None else body_x
    by = base_y * cell if body_y is None else body_y
    bw = base_w * cell if body_w is None else body_w
    bd = base_d * cell if body_d is None else body_d
    bucket = Bucket(
        id=bucket_id,
        name=bucket_id,
        base_cells=RectCells(x=base_x, y=base_y, w=base_w, d=base_d),
        body_mm=RectMM(x=bx, y=by, w=bw, d=bd),
        height_mm=height_mm,
        wall_thickness_mm=1.2,
        floor_thickness_mm=1.2,
    )
    for k, v in overrides.items():
        setattr(bucket, k, v)
    return bucket


def make_project(*buckets: Bucket) -> Project:
    return Project(
        drawer=Drawer(width_mm=500, depth_mm=420, height_mm=80),
        buckets=list(buckets),
    )


@pytest.fixture
def standard_bucket() -> Bucket:
    return make_bucket("standard", 0, 0, base_w=2, base_d=1, height_mm=42)


@pytest.fixture
def overflow_bucket() -> Bucket:
    """2x1 base with body extended 8 mm to the left into overflow region."""
    cell = 42
    return make_bucket(
        "overflow",
        base_x=0, base_y=0, base_w=2, base_d=1,
        body_x=-8, body_y=0, body_w=2 * cell + 8, body_d=cell,
        height_mm=42,
    )
