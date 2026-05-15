"""Naive split logic — derived from the user's existing test suite, expanded."""
from __future__ import annotations

from backend.cad import _render_geometry
from backend.main import _naive_split_bucket, _stl_exports_for_bucket

from .conftest import make_bucket, make_project


def _split(bucket, project):
    return _naive_split_bucket(bucket, project)


def test_naive_split_creates_printable_x_parts() -> None:
    bucket = make_bucket("wide", base_w=8, body_w=320, body_d=42)
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    project = make_project(bucket)
    parts = _split(bucket, project)

    assert [p.id for p in parts] == ["wide_part-1-1", "wide_part-1-2"]
    assert [p.base_cells.w for p in parts] == [6, 2]
    assert [p.base_cells.x for p in parts] == [0, 6]
    assert [p.body_mm.x for p in parts] == [0, 252]
    assert [p.body_mm.w for p in parts] == [252, 68]
    for p in parts:
        assert p.body_mm.w <= project.printer.bed_x_mm


def test_naive_split_preserves_partial_edge_overhang() -> None:
    bucket = make_bucket("edge", base_w=7, body_w=285, body_d=42)
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    parts = _split(bucket, make_project(bucket))

    assert [p.base_cells.w for p in parts] == [6, 1]
    # Seams are contiguous.
    assert parts[0].body_mm.x + parts[0].body_mm.w == parts[1].body_mm.x
    # The far edge keeps the overhang.
    assert parts[-1].body_mm.x + parts[-1].body_mm.w == 285


def test_split_render_geometry_preserves_parent_foot_phase() -> None:
    bucket = make_bucket(
        "edge",
        base_x=3,
        base_y=7,
        base_w=12,
        base_d=4,
        body_x=110,
        body_y=268,
        body_w=524,
        body_d=220,
    )
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    project = make_project(bucket)
    parts = _split(bucket, project)

    geoms = [_render_geometry(part, project) for part in parts]

    assert [part.body_mm.x for part in parts] == [110, 336, 588]
    assert all(geom["clip_enabled"] for geom in geoms)
    assert [geom["clip_x0"] for geom in geoms] == [0, 226, 478]
    assert [geom["clip_x1"] for geom in geoms] == [226, 478, 524]
    assert {geom["foot_offset_x"] for geom in geoms} == {-26}
    assert {geom["foot_offset_y"] for geom in geoms} == {-16}


def test_render_geometry_enables_supportless_lip_by_default() -> None:
    bucket = make_bucket("lip", base_w=2, body_w=84, body_d=42)
    geom = _render_geometry(bucket, make_project(bucket))

    assert geom["include_lip"] is True
    assert geom["supportless_lip"] is True


def test_split_stl_export_returns_multiple_named_stls() -> None:
    bucket = make_bucket("wide", base_w=8, body_w=320, body_d=42)
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    exports = _stl_exports_for_bucket(bucket, make_project(bucket))

    assert [name for name, _ in exports] == ["wide_part-1-1.stl", "wide_part-1-2.stl"]
    for _, data in exports:
        # Real STL output (binary) is much larger than 100 bytes.
        assert len(data) > 200


def test_no_split_when_bucket_fits() -> None:
    bucket = make_bucket("ok", base_w=2, base_d=1, body_w=84, body_d=42)
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    parts = _split(bucket, make_project(bucket))
    # _naive_split_bucket short-circuits when no split is needed.
    assert len(parts) == 1
    assert parts[0].id == "ok"
