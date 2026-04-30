import { describe, expect, it } from "vitest";
import { boundingGridAndCut } from "../../src/cad.js";
import { defaultProject, defaultBucket } from "../../src/models.js";

function p() { return defaultProject(); }

function bucket({ baseX = 0, baseY = 0, baseW = 1, baseD = 1, bodyX, bodyY, bodyW, bodyD }) {
  const cell = 42;
  return defaultBucket(
    "b",
    { x: baseX, y: baseY, w: baseW, d: baseD },
    {
      x: bodyX ?? baseX * cell,
      y: bodyY ?? baseY * cell,
      w: bodyW ?? baseW * cell,
      d: bodyD ?? baseD * cell,
    },
  );
}

describe("boundingGridAndCut", () => {
  it("standard non-overflow: grid = base, cut = full grid", () => {
    const b = bucket({ baseW: 2, baseD: 1 });
    const r = boundingGridAndCut(b, p());
    expect(r.gridW).toBe(2);
    expect(r.gridD).toBe(1);
    expect(r.cut).toEqual([0, 0, 84, 42]);
  });

  it("left overflow 8mm: pads to 3-cell grid, cut at body extent", () => {
    const b = bucket({ baseW: 2, baseD: 1, bodyX: -8, bodyY: 0, bodyW: 92, bodyD: 42 });
    const r = boundingGridAndCut(b, p());
    expect(r.gridW).toBe(3);
    expect(r.gridD).toBe(1);
    // bounding origin at drawer x=-42; body 0..92 in bounding-local = 34..126
    expect(r.cut).toEqual([34, 0, 126, 42]);
  });

  it("all-side overflow 5mm: pads in both axes", () => {
    const b = bucket({ baseW: 2, baseD: 1, bodyX: -5, bodyY: -5, bodyW: 94, bodyD: 52 });
    const r = boundingGridAndCut(b, p());
    expect(r.gridW).toBe(4);
    expect(r.gridD).toBe(3);
  });

  it("split parts: cut_box shifts to bounding-grid-local coords", () => {
    const b = bucket({ baseW: 8, bodyX: 0, bodyW: 336, bodyD: 42 });
    b.parent_body_mm = { ...b.body_mm };
    b.parent_base_cells = { ...b.base_cells };
    b.cut_box_mm = [0, 0, 252, 42]; // first half of split
    const r = boundingGridAndCut(b, p());
    expect(r.gridW).toBe(8);
    expect(r.cut).toEqual([0, 0, 252, 42]);

    b.cut_box_mm = [252, 0, 336, 42];
    const r2 = boundingGridAndCut(b, p());
    expect(r2.cut).toEqual([252, 0, 336, 42]);
  });
});
