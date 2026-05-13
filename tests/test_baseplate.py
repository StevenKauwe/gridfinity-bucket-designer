"""Baseplate export tests."""
from __future__ import annotations

import io
import json
import zipfile

import pytest
import trimesh
from fastapi.testclient import TestClient

from backend.cad import generate_baseplate_stl
from backend.main import _balanced_baseplate_axis_cells, app

from .conftest import make_project


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _load_mesh(stl: bytes) -> trimesh.Trimesh:
    return trimesh.load(io.BytesIO(stl), file_type="stl", force="mesh")


@pytest.mark.usefixtures("openscad_required")
def test_baseplate_renders_for_drawer_grid() -> None:
    project = make_project()  # 500 × 420 mm drawer
    stl = generate_baseplate_stl(project, grid_w=3, grid_d=2)
    mesh = _load_mesh(stl)
    assert mesh.is_winding_consistent
    bx, by, bz = mesh.bounds[1] - mesh.bounds[0]
    assert abs(bx - 126.0) < 0.5  # 3 cells × 42mm
    assert abs(by - 84.0) < 0.5   # 2 cells × 42mm
    assert bz < 10.0              # baseplate is thin


@pytest.mark.usefixtures("openscad_required")
def test_baseplate_endpoint_zips_split_parts(client) -> None:
    """Split baseplate export emits large repeated tile shapes."""
    project = make_project()
    payload = json.loads(project.model_dump_json())
    res = client.post("/api/export/baseplate?split=true", json=payload)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        names = zf.namelist()
        payloads = {zf.read(n) for n in names}
    assert len(names) >= 2
    assert all(n.startswith("baseplate-") for n in names)
    assert len(payloads) <= 2


def test_balanced_baseplate_axis_prefers_large_repeated_spans() -> None:
    assert _balanced_baseplate_axis_cells(
        total_cells=15,
        bed_size=256,
        cell=42,
    ) == [5, 5, 5]
    assert _balanced_baseplate_axis_cells(
        total_cells=11,
        bed_size=256,
        cell=42,
    ) == [6, 5]
    assert _balanced_baseplate_axis_cells(
        total_cells=10,
        bed_size=256,
        cell=42,
    ) == [5, 5]


@pytest.mark.usefixtures("openscad_required")
def test_baseplate_no_split_returns_single_stl(client) -> None:
    project = make_project()
    project.drawer.width_mm = 100
    project.drawer.depth_mm = 100
    payload = json.loads(project.model_dump_json())
    res = client.post("/api/export/baseplate?split=false", json=payload)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("model/stl")
