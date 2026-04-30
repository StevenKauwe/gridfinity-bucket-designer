"""Pydantic model schema tests."""
from __future__ import annotations

import json

from backend.models import Bucket, Project, RectCells, RectMM


def test_bucket_defaults_match_spec_defaults() -> None:
    b = Bucket(
        id="b",
        base_cells=RectCells(x=0, y=0, w=1, d=1),
        body_mm=RectMM(x=0, y=0, w=42, d=42),
    )
    assert b.height_mm == 42
    assert b.include_lip is True
    assert b.magnet_holes is False
    assert b.screw_holes is False
    # Naive split is on by default — only fires when bucket exceeds bed.
    assert b.split.enabled is True
    assert b.split.strategy == "naive"


def test_project_round_trip_through_json() -> None:
    project = Project.model_validate({
        "drawer": {"width_mm": 500, "depth_mm": 420, "height_mm": 80},
        "buckets": [{
            "id": "x",
            "base_cells": {"x": 0, "y": 0, "w": 2, "d": 1},
            "body_mm": {"x": 0, "y": 0, "w": 84, "d": 42},
            "magnet_holes": True,
        }],
    })
    blob = project.model_dump_json()
    restored = Project.model_validate(json.loads(blob))
    assert restored.buckets[0].magnet_holes is True
    assert restored.buckets[0].base_cells.w == 2
