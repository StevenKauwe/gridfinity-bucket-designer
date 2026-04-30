"""Naive split logic — derived from the user's existing test suite, expanded."""
from __future__ import annotations

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
