// JS port of backend/validate.py — bounds, collision, and printer-bed checks.

function bodyRect(b) {
  return [b.body_mm.x, b.body_mm.y, b.body_mm.x + b.body_mm.w, b.body_mm.y + b.body_mm.d];
}
function baseRectMm(b, cellMm) {
  const x = b.base_cells.x * cellMm;
  const y = b.base_cells.y * cellMm;
  return [x, y, x + b.base_cells.w * cellMm, y + b.base_cells.d * cellMm];
}
function overlaps(a, b) {
  return !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
}
function inside(rect, drawer) {
  return drawer[0] <= rect[0] && rect[2] <= drawer[2] && drawer[1] <= rect[1] && rect[3] <= drawer[3];
}

export function validateProject(project) {
  const issues = [];
  const cell = project.grid.cell_mm;
  const drawer = [0, 0, project.drawer.width_mm, project.drawer.depth_mm];
  const printer = project.printer;

  for (let i = 0; i < project.buckets.length; i++) {
    const b = project.buckets[i];
    const body = bodyRect(b);
    const base = baseRectMm(b, cell);

    if (!inside(body, drawer)) {
      issues.push({
        severity: "warning", bucket_id: b.id,
        code: "BODY_OUT_OF_DRAWER",
        message: "Bucket body extends beyond drawer.",
      });
    }
    if (!inside(base, drawer)) {
      issues.push({
        severity: "error", bucket_id: b.id,
        code: "BASE_OUT_OF_DRAWER",
        message: "Gridfinity base extends beyond drawer.",
      });
    }

    const exceedsXy = b.body_mm.w > printer.bed_x_mm || b.body_mm.d > printer.bed_y_mm;
    const exceedsZ = b.height_mm > printer.bed_z_mm;
    const naive = b.split && b.split.enabled && b.split.strategy === "naive";
    if (exceedsXy && naive) {
      issues.push({
        severity: "warning", bucket_id: b.id,
        code: "NAIVE_SPLIT_ENABLED",
        message: "Bucket exceeds printer bed; will export as multiple naive split parts. Uncheck “Naive split” to disable.",
      });
    } else if (exceedsXy || exceedsZ) {
      issues.push({
        severity: "warning", bucket_id: b.id,
        code: "EXCEEDS_PRINTER_BED",
        message: "Bucket exceeds printer bed and split is disabled — export will fail.",
      });
    }
    if (exceedsZ && b.split && b.split.enabled) {
      issues.push({
        severity: "warning", bucket_id: b.id,
        code: "HEIGHT_EXCEEDS_PRINTER_BED",
        message: "Naive split only splits X/Y; bucket height still exceeds printer bed.",
      });
    }

    for (let j = i + 1; j < project.buckets.length; j++) {
      const other = project.buckets[j];
      if (overlaps(body, bodyRect(other))) {
        issues.push({
          severity: "error", bucket_id: b.id,
          code: "BODY_OVERLAP",
          message: `Bucket body overlaps ${other.id}.`,
        });
      }
      if (overlaps(base, baseRectMm(other, cell))) {
        issues.push({
          severity: "error", bucket_id: b.id,
          code: "BASE_OVERLAP",
          message: `Gridfinity base overlaps ${other.id}.`,
        });
      }
    }
  }
  return issues;
}

export function isValid(issues) {
  return !issues.some((i) => i.severity === "error");
}
