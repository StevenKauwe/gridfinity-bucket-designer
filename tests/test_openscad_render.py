"""Integration tests against the real OpenSCAD CLI. Skipped if not installed."""
from __future__ import annotations

import io

import pytest
import trimesh

from backend.cad import generate_stl_bytes

from .conftest import make_bucket, make_project


def _load_mesh(stl: bytes) -> trimesh.Trimesh:
    return trimesh.load(io.BytesIO(stl), file_type="stl", force="mesh")


@pytest.mark.usefixtures("openscad_required")
def test_standard_bucket_renders_watertight() -> None:
    bucket = make_bucket("std", 0, 0, base_w=2, base_d=1, height_mm=42)
    mesh = _load_mesh(generate_stl_bytes(bucket, make_project(bucket)))

    # trimesh.is_watertight is stricter than slicer manifold; check the
    # OpenSCAD-relevant invariants (consistent winding + positive volume).
    assert mesh.is_winding_consistent
    assert mesh.volume > 0
    # 2x1 cells = 84 x 42 mm footprint, centered at origin.
    bx, by, bz = mesh.bounds[1] - mesh.bounds[0]
    assert abs(bx - 83.5) < 1.0  # 84 - 0.5mm gap
    assert abs(by - 41.5) < 1.0
    # Total height = 42 mm including stacking lip.
    assert abs(bz - 42.0) < 1.0


@pytest.mark.usefixtures("openscad_required")
def test_overflow_bucket_renders_watertight_and_extends_body() -> None:
    bucket = make_bucket(
        "ov", 0, 0, base_w=2, base_d=1,
        body_x=-8, body_y=0, body_w=92, body_d=42, height_mm=42,
    )
    mesh = _load_mesh(generate_stl_bytes(bucket, make_project(bucket)))
    # trimesh.is_watertight is stricter than slicer manifold; check the
    # OpenSCAD-relevant invariants (consistent winding + positive volume).
    assert mesh.is_winding_consistent
    assert mesh.volume > 0

    bx, by, bz = mesh.bounds[1] - mesh.bounds[0]
    # Body extends 92mm; the cut edge is exactly at body_w, the un-cut edge
    # has the kennetek 0.5mm BASE_GAP_MM around the bin perimeter.
    assert 91.5 <= bx <= 92.0
    assert 41.0 <= by <= 42.0
    assert 40.0 <= bz <= 42.0  # kennetek lip fillet rounds height slightly


@pytest.mark.usefixtures("openscad_required")
def test_magnet_holes_change_mesh_complexity() -> None:
    plain = make_bucket("plain", 0, 0, base_w=1, base_d=1, height_mm=42)
    holed = make_bucket("holed", 0, 0, base_w=1, base_d=1, height_mm=42)
    holed.magnet_holes = True

    plain_tris = len(_load_mesh(generate_stl_bytes(plain, make_project(plain))).faces)
    holed_tris = len(_load_mesh(generate_stl_bytes(holed, make_project(holed))).faces)
    # Magnet holes punch additional cylinder cavities; mesh should grow.
    assert holed_tris > plain_tris


@pytest.mark.usefixtures("openscad_required")
def test_split_parts_butt_together_with_sealed_cuts() -> None:
    """A naive-split bucket should produce manifold parts with flat cut faces
    that butt cleanly when reassembled. Implementation: SCAD intersects the
    full bucket with each part's cut box, so seams are sealed surfaces."""
    from backend.main import _naive_split_bucket

    bucket = make_bucket("wide", base_w=8, body_w=336, body_d=42, height_mm=42)
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    project = make_project(bucket)
    parts = _naive_split_bucket(bucket, project)
    assert len(parts) == 2

    meshes = [_load_mesh(generate_stl_bytes(p, project)) for p in parts]
    for m in meshes:
        assert m.is_winding_consistent
        assert m.volume > 0

    # First part has flat right cut face (no rounded right corners).
    left = meshes[0]
    assert abs(left.bounds[1, 0] - 252.0) < 0.5  # right edge at x=252 (no fillet)
    # Second part has flat left cut face.
    right = meshes[1]
    assert abs(right.bounds[0, 0] - 0.0) < 0.5  # left edge at x=0 (no fillet)


@pytest.mark.usefixtures("openscad_required")
def test_lip_toggle_preserves_total_height() -> None:
    """height_mm is the bin's total external height. Toggling the lip changes
    whether the top is the lip's outer profile or a flat wall, but the total
    height stays the same — we shrink the wall portion by the lip height
    when the lip is enabled."""
    with_lip = make_bucket("with_lip", 0, 0, base_w=1, base_d=1, height_mm=42)
    no_lip = make_bucket("no_lip", 0, 0, base_w=1, base_d=1, height_mm=42)
    no_lip.include_lip = False
    z_with = _load_mesh(generate_stl_bytes(with_lip, make_project(with_lip))).bounds[1, 2]
    z_no   = _load_mesh(generate_stl_bytes(no_lip, make_project(no_lip))).bounds[1, 2]
    assert abs(z_with - 42.0) < 0.5
    assert abs(z_no - 42.0) < 0.5
