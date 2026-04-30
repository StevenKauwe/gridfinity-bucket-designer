"""FastAPI surface tests using TestClient."""
from __future__ import annotations

import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.main import app

from .conftest import make_bucket, make_project


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _project_payload(bucket):
    return json.loads(make_project(bucket).model_dump_json())


def test_validate_endpoint_returns_no_issues_for_valid_project(client) -> None:
    payload = _project_payload(make_bucket("x", base_w=1, base_d=1))
    res = client.post("/api/validate", json=payload)
    assert res.status_code == 200
    assert res.json() == {"valid": True, "issues": []}


def test_validate_flags_overlapping_buckets(client) -> None:
    proj = make_project(
        make_bucket("a", 0, 0, base_w=2, base_d=2),
        make_bucket("b", 1, 1, base_w=2, base_d=2),
    )
    res = client.post("/api/validate", json=json.loads(proj.model_dump_json()))
    body = res.json()
    assert body["valid"] is False
    codes = {i["code"] for i in body["issues"]}
    assert "BASE_OVERLAP" in codes


def test_export_stl_single_bucket_returns_stl(client, openscad_required) -> None:
    bucket = make_bucket("std", base_w=1, base_d=1, height_mm=42)
    payload = {"project": json.loads(make_project(bucket).model_dump_json()),
               "bucket_ids": ["std"]}
    res = client.post("/api/export/stl", json=payload)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("model/stl")
    # Binary STL: 80-byte header, then little-endian uint32 triangle count.
    import struct
    n_tris = struct.unpack("<I", res.content[80:84])[0]
    assert n_tris > 100
    assert len(res.content) == 84 + n_tris * 50


def test_export_bundle_zips_project_and_stls(client, openscad_required) -> None:
    bucket = make_bucket("std", base_w=1, base_d=1, height_mm=42)
    res = client.post("/api/export/bundle",
                      json=json.loads(make_project(bucket).model_dump_json()))
    assert res.status_code == 200
    with zipfile.ZipFile(__import__("io").BytesIO(res.content)) as zf:
        names = zf.namelist()
    assert "project.json" in names
    assert any(n.endswith(".stl") for n in names)


def test_naive_split_export_returns_zip_with_parts(client, openscad_required) -> None:
    bucket = make_bucket("wide", base_w=8, body_w=320, body_d=42, height_mm=42)
    bucket.split.enabled = True
    bucket.split.strategy = "naive"
    payload = {"project": json.loads(make_project(bucket).model_dump_json()),
               "bucket_ids": ["wide"]}
    res = client.post("/api/export/stl", json=payload)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(__import__("io").BytesIO(res.content)) as zf:
        names = zf.namelist()
    assert any("part-1-1" in n for n in names)
    assert any("part-1-2" in n for n in names)
