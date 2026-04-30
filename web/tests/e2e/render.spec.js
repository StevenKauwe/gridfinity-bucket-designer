import { expect, test } from "@playwright/test";

// In-browser feature parity test: load the static site, run the CAD pipeline
// against the bundled openscad-wasm, and verify the resulting STL bytes are
// real binary STL output for both standard and overflow buckets, plus a
// baseplate.

const BUCKETS = [
  {
    label: "standard 2x1",
    bucket: {
      base_cells: { x: 0, y: 0, w: 2, d: 1 },
      body_mm:    { x: 0, y: 0, w: 84, d: 42 },
      height_mm: 42,
    },
  },
  {
    label: "overflow 8mm left",
    bucket: {
      base_cells: { x: 0, y: 0, w: 2, d: 1 },
      body_mm:    { x: -8, y: 0, w: 92, d: 42 },
      height_mm: 42,
    },
  },
];

test.describe.configure({ mode: "serial" });

test("loads index without errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("svg#editor")).toBeVisible();
  expect(errors).toEqual([]);
});

for (const { label, bucket } of BUCKETS) {
  test(`renders ${label} bucket via WASM`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (b) => {
      const { defaultProject, defaultBucket } = await import("/src/models.js");
      const { generateBucketStl } = await import("/src/cad.js");
      const project = defaultProject();
      const bucket = defaultBucket("t", b.base_cells, b.body_mm);
      bucket.height_mm = b.height_mm;
      project.buckets.push(bucket);
      const stl = await generateBucketStl(bucket, project);
      // Binary STL: 80-byte header, uint32 triangle count, then n*50 bytes.
      const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
      const nTris = dv.getUint32(80, true);
      return {
        size: stl.length,
        nTris,
        expectedSize: 84 + nTris * 50,
        ok: stl.length === 84 + nTris * 50 && nTris > 50,
      };
    }, bucket);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.nTris).toBeGreaterThan(50);
  });
}

test("renders baseplate via WASM", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { defaultProject } = await import("/src/models.js");
    const { generateBaseplateStl } = await import("/src/cad.js");
    const project = defaultProject();
    const stl = await generateBaseplateStl(project, { gridW: 2, gridD: 2 });
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const nTris = dv.getUint32(80, true);
    return { size: stl.length, nTris, ok: stl.length === 84 + nTris * 50 && nTris > 20 };
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
});

test("a split-part bucket (cut_box) renders via WASM", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  // Confirm the cut_box mechanism flows through to OpenSCAD: render the
  // first part of a 2-cell bucket split into 1+1. Unit tests already cover
  // the JS split logic itself; this just verifies the SCAD pipeline accepts
  // cut params and produces a valid STL.
  const result = await page.evaluate(async () => {
    const { defaultProject, defaultBucket } = await import("/src/models.js");
    const { naiveSplitBucket } = await import("/src/split.js");
    const { generateBucketStl } = await import("/src/cad.js");
    const project = defaultProject();
    project.printer.bed_x_mm = 50;  // tiny bed → 2-cell bucket splits 1+1
    project.printer.bed_y_mm = 50;
    const bucket = defaultBucket("wide",
      { x: 0, y: 0, w: 2, d: 1 },
      { x: 0, y: 0, w: 84, d: 42 },
    );
    bucket.height_mm = 42;
    bucket.split.enabled = true;
    bucket.split.strategy = "naive";
    project.buckets.push(bucket);
    const parts = naiveSplitBucket(bucket, project);
    const stl = await generateBucketStl(parts[0], project);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    return {
      nParts: parts.length,
      partIds: parts.map((p) => p.id),
      cutBox: parts[0].cut_box_mm,
      stlBytes: stl.length,
      nTris: dv.getUint32(80, true),
    };
  });
  expect(result.nParts).toBe(2);
  expect(result.partIds).toEqual(["wide_part-1-1", "wide_part-1-2"]);
  expect(result.cutBox).toEqual([0, 0, 42, 42]);
  expect(result.stlBytes).toBe(84 + result.nTris * 50);
  expect(result.nTris).toBeGreaterThan(50);
});
