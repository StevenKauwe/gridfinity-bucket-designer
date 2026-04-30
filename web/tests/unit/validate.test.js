import { describe, expect, it } from "vitest";
import { validateProject, isValid } from "../../src/validate.js";
import { defaultProject, defaultBucket } from "../../src/models.js";

function makeProject(...buckets) {
  const p = defaultProject();
  p.buckets = buckets;
  return p;
}

function bucket(id, baseX, baseY, baseW = 1, baseD = 1, opts = {}) {
  const cell = 42;
  const b = defaultBucket(
    id,
    { x: baseX, y: baseY, w: baseW, d: baseD },
    {
      x: opts.bodyX ?? baseX * cell,
      y: opts.bodyY ?? baseY * cell,
      w: opts.bodyW ?? baseW * cell,
      d: opts.bodyD ?? baseD * cell,
    },
  );
  Object.assign(b, opts.fields || {});
  return b;
}

describe("validateProject", () => {
  it("valid single bucket has no issues", () => {
    expect(validateProject(makeProject(bucket("a", 0, 0)))).toEqual([]);
  });

  it("overlapping bases and bodies are errors", () => {
    const p = makeProject(
      bucket("a", 0, 0, 2, 2),
      bucket("b", 1, 1, 2, 2),
    );
    const codes = new Set(validateProject(p).map((i) => i.code));
    expect(codes).toContain("BASE_OVERLAP");
    expect(codes).toContain("BODY_OVERLAP");
  });

  it("printer-bed overflow with split disabled is a warning", () => {
    const b = bucket("wide", 0, 0, 1, 1, { bodyW: 300, bodyD: 42 });
    b.split.enabled = false;
    const issues = validateProject(makeProject(b));
    expect(issues.map((i) => i.code)).toEqual(["EXCEEDS_PRINTER_BED"]);
    expect(issues[0].severity).toBe("warning");
  });

  it("naive split default warns that split will happen", () => {
    // defaultBucket() ships split.enabled=true so new buckets auto-split.
    const b = bucket("wide", 0, 0, 1, 1, { bodyW: 300, bodyD: 42 });
    expect(b.split.enabled).toBe(true);
    expect(b.split.strategy).toBe("naive");
    const issues = validateProject(makeProject(b));
    expect(issues.map((i) => i.code)).toEqual(["NAIVE_SPLIT_ENABLED"]);
    expect(issues[0].severity).toBe("warning");
  });

  it("base outside drawer is an error", () => {
    const b = bucket("oob", 20, 0, 5, 1);
    expect(
      validateProject(makeProject(b)).some(
        (i) => i.code === "BASE_OUT_OF_DRAWER" && i.severity === "error",
      ),
    ).toBe(true);
  });

  it("isValid returns false when there is any error", () => {
    const p = makeProject(bucket("a", 0, 0, 2, 2), bucket("b", 1, 1, 2, 2));
    expect(isValid(validateProject(p))).toBe(false);
  });
});
