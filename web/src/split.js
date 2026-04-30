// JS port of backend/main.py split logic.

function bucketNeedsXySplit(bucket, project) {
  return bucket.body_mm.w > project.printer.bed_x_mm
      || bucket.body_mm.d > project.printer.bed_y_mm;
}

export function splitAxisOnBaseCells({ baseStart, baseCount, bodyStart, bodySize, bedSize, cell }) {
  if (baseCount <= 0) {
    throw new Error("Naive split requires at least one base cell per axis");
  }
  const maxCells = Math.max(1, Math.floor(bedSize / cell));
  const bodyEnd = bodyStart + bodySize;
  const ranges = [];
  let cursor = baseStart;
  const baseEnd = baseStart + baseCount;

  while (cursor < baseEnd) {
    const remaining = baseEnd - cursor;
    let chosen = null;
    for (let cells = Math.min(maxCells, remaining); cells >= 1; cells--) {
      const nextCursor = cursor + cells;
      const partBodyStart = cursor === baseStart ? bodyStart : cursor * cell;
      const partBodyEnd = nextCursor === baseEnd ? bodyEnd : nextCursor * cell;
      const partBodySize = partBodyEnd - partBodyStart;
      if (partBodySize <= bedSize) {
        chosen = { cells, partBodyStart, partBodySize };
        break;
      }
    }
    if (!chosen) {
      throw new Error(
        "Naive split cannot fit this bucket while keeping seams on base-cell boundaries",
      );
    }
    ranges.push([cursor, chosen.cells, chosen.partBodyStart, chosen.partBodySize]);
    cursor += chosen.cells;
  }
  return ranges;
}

export function naiveSplitBucket(bucket, project) {
  if (project.printer.bed_x_mm <= 0 || project.printer.bed_y_mm <= 0) {
    throw new Error("Printer bed dimensions must be positive");
  }
  if (!bucketNeedsXySplit(bucket, project)) {
    return [bucket];
  }
  const cell = project.grid.cell_mm;
  const xRanges = splitAxisOnBaseCells({
    baseStart: bucket.base_cells.x,
    baseCount: bucket.base_cells.w,
    bodyStart: bucket.body_mm.x,
    bodySize: bucket.body_mm.w,
    bedSize: project.printer.bed_x_mm,
    cell,
  });
  const yRanges = splitAxisOnBaseCells({
    baseStart: bucket.base_cells.y,
    baseCount: bucket.base_cells.d,
    bodyStart: bucket.body_mm.y,
    bodySize: bucket.body_mm.d,
    bedSize: project.printer.bed_y_mm,
    cell,
  });

  const parts = [];
  for (let row = 1; row <= yRanges.length; row++) {
    const [baseY, baseD, bodyY, bodyD] = yRanges[row - 1];
    for (let col = 1; col <= xRanges.length; col++) {
      const [baseX, baseW, bodyX, bodyW] = xRanges[col - 1];
      const part = JSON.parse(JSON.stringify(bucket));
      part.id = `${bucket.id}_part-${row}-${col}`;
      part.name = `${bucket.name || bucket.id} part ${row}-${col}`;
      part.body_mm = { x: bodyX, y: bodyY, w: bodyW, d: bodyD };
      part.base_cells = { x: baseX, y: baseY, w: baseW, d: baseD };
      part.parent_body_mm = { ...bucket.body_mm };
      part.parent_base_cells = { ...bucket.base_cells };
      part.cut_box_mm = [
        bodyX - bucket.body_mm.x,
        bodyY - bucket.body_mm.y,
        bodyX + bodyW - bucket.body_mm.x,
        bodyY + bodyD - bucket.body_mm.y,
      ];
      parts.push(part);
    }
  }
  return parts;
}

export function baseplateSplitRanges(totalCells, bedSize, cell) {
  const maxCells = Math.max(1, Math.floor(bedSize / cell));
  const ranges = [];
  let cursor = 0;
  while (cursor < totalCells) {
    const count = Math.min(maxCells, totalCells - cursor);
    ranges.push([cursor, count]);
    cursor += count;
  }
  return ranges;
}
