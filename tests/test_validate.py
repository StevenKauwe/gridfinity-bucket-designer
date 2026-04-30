"""Validation rules unit tests."""
from __future__ import annotations

from backend.validate import validate_project

from .conftest import make_bucket, make_project


def test_valid_single_bucket_has_no_issues() -> None:
    issues = validate_project(make_project(make_bucket()))
    assert issues == []


def test_overlapping_bases_and_bodies_are_errors() -> None:
    project = make_project(
        make_bucket("a", 0, 0, base_w=2, base_d=2),
        make_bucket("b", 1, 1, base_w=2, base_d=2),
    )
    issues = validate_project(project)
    codes = {i.code for i in issues}
    assert {"BASE_OVERLAP", "BODY_OVERLAP"} <= codes
    assert all(i.severity == "error" for i in issues)


def test_printer_bed_overflow_with_split_disabled_is_warning() -> None:
    bucket = make_bucket("wide", body_w=300, body_d=42)
    bucket.split.enabled = False
    issues = validate_project(make_project(bucket))
    assert [i.code for i in issues] == ["EXCEEDS_PRINTER_BED"]
    assert issues[0].severity == "warning"


def test_naive_split_default_warns_that_split_will_happen() -> None:
    bucket = make_bucket("wide", body_w=300, body_d=42)
    # split.enabled defaults to True; new buckets auto-split when too big.
    assert bucket.split.enabled is True
    issues = validate_project(make_project(bucket))
    assert [i.code for i in issues] == ["NAIVE_SPLIT_ENABLED"]
    assert issues[0].severity == "warning"


def test_base_outside_drawer_is_error() -> None:
    bucket = make_bucket("oob", base_x=20, base_y=0, base_w=5, base_d=1)
    issues = validate_project(make_project(bucket))
    assert any(i.code == "BASE_OUT_OF_DRAWER" and i.severity == "error" for i in issues)
