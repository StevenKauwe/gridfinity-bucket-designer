from __future__ import annotations

from .models import Bucket, Issue, Project, RectMM


def _bucket_body_rect(b: Bucket) -> tuple[float, float, float, float]:
    return (b.body_mm.x, b.body_mm.y, b.body_mm.x + b.body_mm.w, b.body_mm.y + b.body_mm.d)


def _bucket_base_rect_mm(b: Bucket, cell_mm: float) -> tuple[float, float, float, float]:
    bx = b.base_cells.x * cell_mm
    by = b.base_cells.y * cell_mm
    return (bx, by, bx + b.base_cells.w * cell_mm, by + b.base_cells.d * cell_mm)


def _overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def validate_project(project: Project) -> list[Issue]:
    issues: list[Issue] = []
    cell = project.grid.cell_mm
    drawer_rect = (0.0, 0.0, project.drawer.width_mm, project.drawer.depth_mm)

    for i, b in enumerate(project.buckets):
        body = _bucket_body_rect(b)
        base = _bucket_base_rect_mm(b, cell)

        if not (drawer_rect[0] <= body[0] and body[2] <= drawer_rect[2]
                and drawer_rect[1] <= body[1] and body[3] <= drawer_rect[3]):
            issues.append(Issue(severity="warning", bucket_id=b.id,
                                code="BODY_OUT_OF_DRAWER",
                                message="Bucket body extends beyond drawer."))

        if not (drawer_rect[0] <= base[0] and base[2] <= drawer_rect[2]
                and drawer_rect[1] <= base[1] and base[3] <= drawer_rect[3]):
            issues.append(Issue(severity="error", bucket_id=b.id,
                                code="BASE_OUT_OF_DRAWER",
                                message="Gridfinity base extends beyond drawer."))

        exceeds_xy = b.body_mm.w > project.printer.bed_x_mm or b.body_mm.d > project.printer.bed_y_mm
        exceeds_z = b.height_mm > project.printer.bed_z_mm
        if exceeds_xy and b.split.enabled and b.split.strategy == "naive":
            issues.append(Issue(severity="info", bucket_id=b.id,
                                code="NAIVE_SPLIT_ENABLED",
                                message="Bucket will export as multiple naive split STLs."))
        elif exceeds_xy or exceeds_z:
            issues.append(Issue(severity="warning", bucket_id=b.id,
                                code="EXCEEDS_PRINTER_BED",
                                message="Bucket exceeds printer bed; needs split."))

        if exceeds_z and b.split.enabled:
            issues.append(Issue(severity="warning", bucket_id=b.id,
                                code="HEIGHT_EXCEEDS_PRINTER_BED",
                                message="Naive split only splits X/Y; bucket height still exceeds printer bed."))

        for j, other in enumerate(project.buckets):
            if j <= i:
                continue
            obody = _bucket_body_rect(other)
            obase = _bucket_base_rect_mm(other, cell)
            if _overlaps(body, obody):
                issues.append(Issue(severity="error", bucket_id=b.id,
                                    code="BODY_OVERLAP",
                                    message=f"Bucket body overlaps {other.id}."))
            if _overlaps(base, obase):
                issues.append(Issue(severity="error", bucket_id=b.id,
                                    code="BASE_OVERLAP",
                                    message=f"Gridfinity base overlaps {other.id}."))

    return issues
