import { describe, expect, it } from "vitest";
import { naiveSplitBucket, baseplateSplitRanges } from "../../src/split.js";
import { defaultProject, defaultBucket } from "../../src/models.js";

function project() {
  return defaultProject();
}

function bucket(id, baseW, bodyW, bodyD = 42) {
  const b = defaultBucket(
    id,
    { x: 0, y: 0, w: baseW, d: 1 },
    { x: 0, y: 0, w: bodyW, d: bodyD },
  );
  b.split.enabled = true;
  b.split.strategy = "naive";
  return b;
}

describe("naiveSplitBucket", () => {
  it("splits 8-cell into 6+2 for 256mm bed", () => {
    const p = project();
    const b = bucket("wide", 8, 320, 42);
    const parts = naiveSplitBucket(b, p);
    expect(parts.map((x) => x.id)).toEqual(["wide_part-1-1", "wide_part-1-2"]);
    expect(parts.map((x) => x.base_cells.w)).toEqual([6, 2]);
    expect(parts.map((x) => x.base_cells.x)).toEqual([0, 6]);
    expect(parts.map((x) => x.body_mm.x)).toEqual([0, 252]);
    expect(parts.map((x) => x.body_mm.w)).toEqual([252, 68]);
    for (const part of parts) expect(part.body_mm.w).toBeLessThanOrEqual(p.printer.bed_x_mm);
  });

  it("preserves partial edge overhang on the far side only", () => {
    const parts = naiveSplitBucket(bucket("edge", 7, 285, 42), project());
    expect(parts.map((p) => p.base_cells.w)).toEqual([6, 1]);
    // Seams are contiguous.
    expect(parts[0].body_mm.x + parts[0].body_mm.w).toBe(parts[1].body_mm.x);
    // Far edge keeps the overhang.
    expect(parts[1].body_mm.x + parts[1].body_mm.w).toBe(285);
  });

  it("returns single bucket when split not needed", () => {
    const parts = naiveSplitBucket(bucket("ok", 2, 84, 42), project());
    expect(parts.length).toBe(1);
    expect(parts[0].id).toBe("ok");
  });

  it("split parts carry parent geometry and cut box for sealed cuts", () => {
    const b = bucket("wide", 8, 336, 42);
    const parts = naiveSplitBucket(b, project());
    expect(parts[0].parent_body_mm).toEqual(b.body_mm);
    expect(parts[0].parent_base_cells).toEqual(b.base_cells);
    expect(parts[0].cut_box_mm).toEqual([0, 0, 252, 42]);
    expect(parts[1].cut_box_mm).toEqual([252, 0, 336, 42]);
  });
});

describe("baseplateSplitRanges", () => {
  it("splits cell count by build-plate width", () => {
    expect(baseplateSplitRanges(11, 256, 42)).toEqual([
      [0, 6],
      [6, 5],
    ]);
  });

  it("returns a single span when plate fits", () => {
    expect(baseplateSplitRanges(3, 256, 42)).toEqual([[0, 3]]);
  });
});
