"""Verify the renderer falls back to legacy hand-rolled CAD when OpenSCAD is missing."""
from __future__ import annotations

import io

import numpy as np
from stl import mesh as stl_mesh

from backend import cad, legacy_cad

from .conftest import make_bucket, make_project


def _triangles(stl_bytes: bytes) -> np.ndarray:
    return stl_mesh.Mesh.from_file("x.stl", fh=io.BytesIO(stl_bytes)).vectors


def test_falls_back_to_legacy_when_openscad_missing(monkeypatch) -> None:
    monkeypatch.setattr(cad, "find_openscad", lambda: None)
    bucket = make_bucket("fb", 0, 0, base_w=1, base_d=1, height_mm=42)
    project = make_project(bucket)

    fallback = _triangles(cad.generate_stl_bytes(bucket, project))
    direct = _triangles(legacy_cad.generate_stl_bytes(bucket, project))

    # The header bytes differ (numpy-stl writes a timestamp); the geometry
    # should match exactly because the dispatcher just re-invokes legacy_cad.
    assert fallback.shape == direct.shape
    np.testing.assert_array_equal(fallback, direct)
    assert len(fallback) > 10  # at least a few triangles emitted
