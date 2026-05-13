from __future__ import annotations

import io
import logging
import math
import zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .cad import generate_baseplate_stl, generate_stl_bytes
from .models import Bucket, ExportRequest, Project, RectCells, RectMM, ValidateResponse
from .openscad import openscad_version
from .validate import validate_project

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"

log = logging.getLogger(__name__)


from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app):
    version = openscad_version()
    if version:
        log.info("OpenSCAD detected: %s", version)
    else:
        log.warning(
            "OpenSCAD not found. Exports will use the legacy hand-rolled "
            "renderer (approximate geometry). Install OpenSCAD for spec-correct "
            "Gridfinity output.",
        )
    yield


app = FastAPI(title="Gridfinity Bucket Designer", lifespan=lifespan)


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

    n_rows = len(y_ranges)
    n_cols = len(x_ranges)
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
            # Tell the renderer to build the parent (un-split) bucket and
            # clip with this part's bounding box. OpenSCAD intersection seals
            # the cut faces, so neighboring parts butt together cleanly.
            part.parent_body_mm = bucket.body_mm.model_copy()
            part.parent_base_cells = bucket.base_cells.model_copy()
            part.cut_box_mm = [
                body_x - bucket.body_mm.x,
                body_y - bucket.body_mm.y,
                body_x + body_w - bucket.body_mm.x,
                body_y + body_d - bucket.body_mm.y,
            ]
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


def _balanced_baseplate_axis_cells(total_cells: int, bed_size: float, cell: float) -> list[int]:
    """Split one axis into large, repeatable spans that fit the bed.

    Prefer the minimum number of spans first, then the fewest unique span
    lengths, then larger minimum span length. This keeps baseplates stiff
    without making every tile position-specific.
    """
    max_cells = max(1, math.floor(bed_size / cell))
    span_count = math.ceil(total_cells / max_cells)
    spans: list[list[int]] = []

    def build(prefix: list[int], remaining: int) -> None:
        slots_left = span_count - len(prefix)
        if slots_left == 0:
            if remaining == 0:
                spans.append(prefix.copy())
            return
        min_value = max(1, remaining - max_cells * (slots_left - 1))
        max_value = min(max_cells, remaining - (slots_left - 1))
        for value in range(max_value, min_value - 1, -1):
            prefix.append(value)
            build(prefix, remaining - value)
            prefix.pop()

    build([], total_cells)
    return min(
        spans,
        key=lambda s: (
            len(set(s)),
            -min(s),
            max(s) - min(s),
            tuple(-v for v in s),
        ),
    )


def _baseplate_exports(
    project: Project,
    *,
    grid_w: int,
    grid_d: int,
    style_plate: int,
    style_hole: int,
    enable_magnet: bool,
    split: bool,
) -> list[tuple[str, bytes]]:
    cell = project.grid.cell_mm
    if not split:
        return [
            (
                "baseplate.stl",
                generate_baseplate_stl(
                    project,
                    grid_w=grid_w,
                    grid_d=grid_d,
                    style_plate=style_plate,
                    style_hole=style_hole,
                    enable_magnet=enable_magnet,
                ),
            )
        ]

    x_spans = _balanced_baseplate_axis_cells(grid_w, project.printer.bed_x_mm, cell)
    y_spans = _balanced_baseplate_axis_cells(grid_d, project.printer.bed_y_mm, cell)
    shape_counts: dict[tuple[int, int], int] = {}
    for tile_d in y_spans:
        for tile_w in x_spans:
            shape_counts[(tile_w, tile_d)] = shape_counts.get((tile_w, tile_d), 0) + 1

    if len(shape_counts) == 1 and next(iter(shape_counts.values())) == 1:
        tile_w, tile_d = next(iter(shape_counts))
        return [
            (
                "baseplate.stl",
                generate_baseplate_stl(
                    project,
                    grid_w=tile_w,
                    grid_d=tile_d,
                    style_plate=style_plate,
                    style_hole=style_hole,
                    enable_magnet=enable_magnet,
                ),
            )
        ]

    exports: list[tuple[str, bytes]] = []
    for (tile_w, tile_d), count in sorted(shape_counts.items(), key=lambda item: (-item[0][0] * item[0][1], item[0])):
        data = generate_baseplate_stl(
            project,
            grid_w=tile_w,
            grid_d=tile_d,
            style_plate=style_plate,
            style_hole=style_hole,
            enable_magnet=enable_magnet,
        )
        for idx in range(1, count + 1):
            exports.append((f"baseplate-{tile_w}x{tile_d}-copy-{idx:03d}.stl", data))
    return exports


@app.post("/api/export/baseplate")
def api_export_baseplate(
    project: Project,
    style_plate: int = 0,
    style_hole: int = 0,
    enable_magnet: bool = False,
    split: bool = True,
):
    """Render a Gridfinity baseplate covering the drawer's grid.

    Query params:
      style_plate: 0=thin, 1=weighted, 2=skeletonized, 3=screw-together,
                   4=screw-together-minimal
      style_hole:  0=none, 1=countersink, 2=counterbore (for drawer mount)
      enable_magnet: add magnet pockets
      split: if True, split into build-plate-sized chunks when too large
    """
    cell = project.grid.cell_mm
    grid_w = math.floor(project.drawer.width_mm / cell)
    grid_d = math.floor(project.drawer.depth_mm / cell)
    if grid_w <= 0 or grid_d <= 0:
        raise HTTPException(400, "Drawer too small for any baseplate cell")

    exports = _baseplate_exports(
        project,
        grid_w=grid_w, grid_d=grid_d,
        style_plate=style_plate, style_hole=style_hole,
        enable_magnet=enable_magnet, split=split,
    )

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
        headers={"Content-Disposition": 'attachment; filename="baseplate.zip"'},
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
