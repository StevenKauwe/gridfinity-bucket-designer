import { describe, expect, it } from "vitest";
import { renderGeometry } from "../../src/cad.js";
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

describe("renderGeometry", () => {
  it("standard non-overflow: body and foot cover match base", () => {
    const b = bucket({ baseW: 2, baseD: 1 });
    const r = renderGeometry(b, p());
    expect(r.body_w).toBe(84);
    expect(r.body_d).toBe(42);
    expect(r.base_grid_w).toBe(2);
    expect(r.base_grid_d).toBe(1);
    expect(r.base_offset_x).toBe(0);
    expect(r.base_offset_y).toBe(0);
    expect(r.foot_grid_w).toBe(2);
    expect(r.foot_grid_d).toBe(1);
    expect(r.foot_offset_x).toBe(0);
    expect(r.foot_offset_y).toBe(0);
  });

  it("left overflow 8mm: foot cover pads to grid while body stays fractional", () => {
    const b = bucket({ baseW: 2, baseD: 1, bodyX: -8, bodyY: 0, bodyW: 92, bodyD: 42 });
    const r = renderGeometry(b, p());
    expect(r.body_w).toBe(92);
    expect(r.base_offset_x).toBe(8);
    expect(r.foot_grid_w).toBe(3);
    expect(r.foot_grid_d).toBe(1);
    expect(r.foot_offset_x).toBe(-34);
    expect(r.foot_offset_y).toBe(0);
  });

  it("all-side overflow 5mm: foot cover pads in both axes", () => {
    const b = bucket({ baseW: 2, baseD: 1, bodyX: -5, bodyY: -5, bodyW: 94, bodyD: 52 });
    const r = renderGeometry(b, p());
    expect(r.foot_grid_w).toBe(4);
    expect(r.foot_grid_d).toBe(3);
    expect(r.foot_offset_x).toBe(-37);
    expect(r.foot_offset_y).toBe(-37);
  });

  it("split parts: seam flags mark only interior cut sides", () => {
    const b = bucket({ baseW: 8, bodyX: 0, bodyW: 336, bodyD: 42 });
    b.parent_body_mm = { ...b.body_mm };
    b.parent_base_cells = { ...b.base_cells };
    b.body_mm = { x: 0, y: 0, w: 252, d: 42 };
    const r = renderGeometry(b, p());
    expect(r.seam_x0).toBe(false);
    expect(r.seam_x1).toBe(true);

    b.body_mm = { x: 252, y: 0, w: 84, d: 42 };
    const r2 = renderGeometry(b, p());
    expect(r2.seam_x0).toBe(true);
    expect(r2.seam_x1).toBe(false);
  });

  it("enables supportless top lip geometry by default", () => {
    const b = bucket({ baseW: 2, baseD: 1 });
    const r = renderGeometry(b, p());

    expect(r.include_lip).toBe(true);
    expect(r.supportless_lip).toBe(true);
  });
});
