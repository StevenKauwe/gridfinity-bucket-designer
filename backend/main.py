from __future__ import annotations

import io
import math
import zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .cad import generate_stl_bytes
from .models import Bucket, ExportRequest, Project, RectCells, RectMM, ValidateResponse
from .validate import validate_project

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"

app = FastAPI(title="Gridfinity Bucket Designer")


def _bucket_needs_xy_split(bucket: Bucket, project: Project) -> bool:
    return bucket.body_mm.w > project.printer.bed_x_mm or bucket.body_mm.d > project.printer.bed_y_mm


def _split_axis_on_base_cells(
    *,
    base_start: int,
    base_count: int,
    body_start: float,
    body_size: float,
    bed_size: float,
    cell: float,
) -> list[tuple[int, int, float, float]]:
    """Return base-cell spans and matching body spans for one axis.

    Split seams are placed on Gridfinity cell boundaries so each part owns a
    non-overlapping slice of the base. First/last body spans keep any body
    overhang beyond the base, which supports edge buckets that fill a partial
    drawer cell.
    """
    if base_count <= 0:
        raise HTTPException(400, "Naive split requires at least one base cell per axis")

    max_cells = max(1, math.floor(bed_size / cell))
    body_end = body_start + body_size
    ranges: list[tuple[int, int, float, float]] = []
    cursor = base_start
    base_end = base_start + base_count

    while cursor < base_end:
        remaining = base_end - cursor
        chosen: tuple[int, float, float] | None = None
        for cells in range(min(max_cells, remaining), 0, -1):
            next_cursor = cursor + cells
            part_body_start = body_start if cursor == base_start else cursor * cell
            part_body_end = body_end if next_cursor == base_end else next_cursor * cell
            part_body_size = part_body_end - part_body_start
            if part_body_size <= bed_size:
                chosen = (cells, part_body_start, part_body_size)
                break

        if chosen is None:
            raise HTTPException(
                400,
                "Naive split cannot fit this bucket while keeping split seams on base-cell boundaries",
            )

        cells, part_body_start, part_body_size = chosen
        ranges.append((cursor, cells, part_body_start, part_body_size))
        cursor += cells

    return ranges


def _naive_split_bucket(bucket: Bucket, project: Project) -> list[Bucket]:
    """Split an oversized rectangular bucket into printable rectangular chunks.

    This is intentionally naive: it adds plain walls on cut faces and does not
    create connector geometry. The resulting STLs are separate printable parts
    that can be placed together to approximate the original bucket footprint.
    """
    bed_x = project.printer.bed_x_mm
    bed_y = project.printer.bed_y_mm
    if bed_x <= 0 or bed_y <= 0:
        raise HTTPException(400, "Printer bed dimensions must be positive")

    if not _bucket_needs_xy_split(bucket, project):
        return [bucket]

    cell = project.grid.cell_mm
    x_ranges = _split_axis_on_base_cells(
        base_start=bucket.base_cells.x,
        base_count=bucket.base_cells.w,
        body_start=bucket.body_mm.x,
        body_size=bucket.body_mm.w,
        bed_size=bed_x,
        cell=cell,
    )
    y_ranges = _split_axis_on_base_cells(
        base_start=bucket.base_cells.y,
        base_count=bucket.base_cells.d,
        body_start=bucket.body_mm.y,
        body_size=bucket.body_mm.d,
        bed_size=bed_y,
        cell=cell,
    )
    parts: list[Bucket] = []

    for row, (base_y, base_d, body_y, body_d) in enumerate(y_ranges, start=1):
        for col, (base_x, base_w, body_x, body_w) in enumerate(x_ranges, start=1):
            part = bucket.model_copy(deep=True)
            part.id = f"{bucket.id}_part-{row}-{col}"
            part.name = f"{bucket.name or bucket.id} part {row}-{col}"
            part.body_mm = RectMM(x=body_x, y=body_y, w=body_w, d=body_d)
            part.base_cells = RectCells(
                x=base_x,
                y=base_y,
                w=base_w,
                d=base_d,
            )
            parts.append(part)

    return parts


def _stl_exports_for_bucket(bucket: Bucket, project: Project) -> list[tuple[str, bytes]]:
    if bucket.split.enabled and bucket.split.strategy == "naive":
        parts = _naive_split_bucket(bucket, project)
    else:
        parts = [bucket]
    return [(f"{part.id}.stl", generate_stl_bytes(part, project)) for part in parts]


@app.post("/api/validate", response_model=ValidateResponse)
def api_validate(project: Project) -> ValidateResponse:
    issues = validate_project(project)
    has_error = any(i.severity == "error" for i in issues)
    return ValidateResponse(valid=not has_error, issues=issues)


@app.post("/api/export/stl")
def api_export_stl(req: ExportRequest):
    ids = set(req.bucket_ids) if req.bucket_ids else None
    targets = [b for b in req.project.buckets if ids is None or b.id in ids]
    if not targets:
        raise HTTPException(404, "No matching buckets")

    exports = [
        (name if len(targets) == 1 else f"{bucket.id}/{name}", data)
        for bucket in targets
        for name, data in _stl_exports_for_bucket(bucket, req.project)
    ]

    if len(exports) == 1:
        name, data = exports[0]
        return Response(
            content=data,
            media_type="model/stl",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in exports:
            zf.writestr(name, data)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="buckets.zip"'},
    )


@app.post("/api/export/bundle")
def api_export_bundle(project: Project):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.json", project.model_dump_json(indent=2))
        for b in project.buckets:
            for name, data in _stl_exports_for_bucket(b, project):
                zf.writestr(f"stl/{b.id}/{name}", data)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="gridfinity-project.zip"'},
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
