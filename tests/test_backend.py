from __future__ import annotations

import io
import unittest

from stl import mesh

from backend.cad import generate_stl_bytes
from backend.main import _naive_split_bucket, _stl_exports_for_bucket
from backend.models import Bucket, Drawer, Project, RectCells, RectMM
from backend.validate import validate_project


def make_project(*buckets: Bucket) -> Project:
    return Project(
        drawer=Drawer(width_mm=500, depth_mm=420, height_mm=80),
        buckets=list(buckets),
    )


def make_bucket(
    bucket_id: str,
    base_x: int,
    base_y: int,
    base_w: int = 1,
    base_d: int = 1,
    body_x: float | None = None,
    body_y: float | None = None,
    body_w: float | None = None,
    body_d: float | None = None,
) -> Bucket:
    cell = 42
    return Bucket(
        id=bucket_id,
        name=bucket_id,
        base_cells=RectCells(x=base_x, y=base_y, w=base_w, d=base_d),
        body_mm=RectMM(
            x=base_x * cell if body_x is None else body_x,
            y=base_y * cell if body_y is None else body_y,
            w=base_w * cell if body_w is None else body_w,
            d=base_d * cell if body_d is None else body_d,
        ),
    )


class ValidationTests(unittest.TestCase):
    def test_valid_single_bucket_has_no_issues(self) -> None:
        issues = validate_project(make_project(make_bucket("a", 0, 0)))

        self.assertEqual(issues, [])

    def test_overlapping_bases_and_bodies_are_errors(self) -> None:
        project = make_project(
            make_bucket("a", 0, 0, 2, 2),
            make_bucket("b", 1, 1, 2, 2),
        )

        issues = validate_project(project)
        codes = {issue.code for issue in issues}

        self.assertIn("BASE_OVERLAP", codes)
        self.assertIn("BODY_OVERLAP", codes)
        self.assertTrue(all(issue.severity == "error" for issue in issues))

    def test_printer_bed_overflow_is_warning(self) -> None:
        project = make_project(make_bucket("wide", 0, 0, body_w=300, body_d=42))

        issues = validate_project(project)

        self.assertEqual([issue.code for issue in issues], ["EXCEEDS_PRINTER_BED"])
        self.assertEqual(issues[0].severity, "warning")

    def test_naive_split_suppresses_xy_bed_warning(self) -> None:
        bucket = make_bucket("wide", 0, 0, body_w=300, body_d=42)
        bucket.split.enabled = True
        bucket.split.strategy = "naive"
        project = make_project(bucket)

        issues = validate_project(project)

        self.assertEqual([issue.code for issue in issues], ["NAIVE_SPLIT_ENABLED"])
        self.assertEqual(issues[0].severity, "info")


class CadTests(unittest.TestCase):
    def test_stl_export_is_local_to_bucket_not_drawer_position(self) -> None:
        bucket = make_bucket("far", 8, 6, 2, 1)
        project = make_project(bucket)

        stl = mesh.Mesh.from_file("far.stl", fh=io.BytesIO(generate_stl_bytes(bucket, project)))
        mins = stl.vectors.reshape(-1, 3).min(axis=0)
        maxes = stl.vectors.reshape(-1, 3).max(axis=0)

        self.assertGreaterEqual(mins[0], -0.001)
        self.assertGreaterEqual(mins[1], -0.001)
        self.assertLess(maxes[0], 100)
        self.assertLess(maxes[1], 60)


class SplitExportTests(unittest.TestCase):
    def test_naive_split_creates_printable_x_parts(self) -> None:
        bucket = make_bucket("wide", 0, 0, base_w=8, body_w=320, body_d=42)
        bucket.split.enabled = True
        bucket.split.strategy = "naive"
        project = make_project(bucket)

        parts = _naive_split_bucket(bucket, project)

        self.assertEqual([part.id for part in parts], ["wide_part-1-1", "wide_part-1-2"])
        self.assertEqual([part.base_cells.w for part in parts], [6, 2])
        self.assertEqual([part.base_cells.x for part in parts], [0, 6])
        self.assertEqual([part.body_mm.x for part in parts], [0, 252])
        self.assertEqual([part.body_mm.w for part in parts], [252, 68])
        self.assertLessEqual(parts[0].body_mm.w, project.printer.bed_x_mm)
        self.assertLessEqual(parts[1].body_mm.w, project.printer.bed_x_mm)

    def test_naive_split_preserves_partial_edge_overhang(self) -> None:
        bucket = make_bucket("edge", 0, 0, base_w=7, body_w=285, body_d=42)
        bucket.split.enabled = True
        bucket.split.strategy = "naive"
        project = make_project(bucket)

        parts = _naive_split_bucket(bucket, project)

        self.assertEqual([part.base_cells.w for part in parts], [6, 1])
        self.assertEqual(parts[0].body_mm.x + parts[0].body_mm.w, parts[1].body_mm.x)
        self.assertEqual(parts[-1].body_mm.x + parts[-1].body_mm.w, 285)

    def test_split_stl_export_returns_multiple_named_stls(self) -> None:
        bucket = make_bucket("wide", 0, 0, base_w=8, body_w=320, body_d=42)
        bucket.split.enabled = True
        bucket.split.strategy = "naive"
        project = make_project(bucket)

        exports = _stl_exports_for_bucket(bucket, project)

        self.assertEqual([name for name, _ in exports], ["wide_part-1-1.stl", "wide_part-1-2.stl"])
        for _, data in exports:
            self.assertGreater(len(data), 100)


if __name__ == "__main__":
    unittest.main()
