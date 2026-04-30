# Gridfinity Bucket Designer — browser-only build

Pure-static port of the Python/FastAPI app. All rendering happens in the
browser via [openscad-wasm](https://github.com/openscad/openscad-wasm). Deploy
to GitHub Pages, open from anywhere — no backend.

## Performance & caching

`openscad-wasm` 2022.03.20 uses CGAL booleans, which run **5–10× slower in
the browser than native OpenSCAD on Apple Silicon** (typical 1×1 bin: ~1 s
native, ~5–10 s WASM). Three caching tiers paper over this:

1. **In-memory cache** — same-session repeats are instant.
2. **localStorage cache** — persists across reloads, ~12 MB budget.
3. **Precomputed CDN cache** — `web/cache/<scad-stem>/<sha256>.stl.gz`. Run
   `uv run python web/scripts/precompute.py` once locally; the default
   matrix (1×1..6×6 bins at 3u/6u/8u, magnets on/off, baseplates 1×1..6×6
   = 216 + 36 STLs, ~94 MB after gzip −9) gets prebuilt and committed
   alongside the static site. Browser fetches the gzip, decompresses via
   `DecompressionStream`, and caches the inflated STL — so first-time
   exports are also instant for any covered config.

Edit `web/scripts/precompute.py` to extend the matrix (more heights,
scoop variants, etc.) — the JS side keys on a SHA-256 hash that both Python
and JavaScript compute identically.

## Run locally

```bash
cd web
python3 -m http.server 8000
# open http://127.0.0.1:8000
```

(Any static file server works — `npx serve`, `caddy`, etc. The site needs to
be served over HTTP/HTTPS for `import.meta.url` and the WASM `fetch` to
resolve correctly; opening `index.html` via `file://` won't work.)

## Tests

```bash
cd web
npm install
npm test          # 16 unit tests for validate/split/cad-dispatcher
npm run e2e:install
npm run test:e2e  # browser-based WASM render parity tests (Playwright)
```

E2E tests boot a local http server, drive headless Chromium, and run the
exact same CAD pipeline (`generateBucketStl`, `generateBaseplateStl`,
`naiveSplitBucket`) the deployed site uses. Each test renders real STLs and
verifies the binary header (`84 + n_tris*50` bytes).

## Layout

```
web/
  index.html
  app.js                browser entry — same UI as ../frontend, no /api fetches
  style.css
  src/
    models.js           defaultProject + defaultBucket helpers
    validate.js         port of backend/validate.py
    split.js            port of naive split logic
    cad.js              dispatcher — renderGeometry, generateBucketStl
    openscad.js         openscad-wasm wrapper (mounts SCAD FS, runs callMain)
  scad/                 our SCAD wrappers (standard.scad, baseplate.scad, overflow.scad)
  vendor/
    gridfinity-rebuilt-openscad/   kennetek SCAD library, MIT
    openscad/           openscad.wasm + JS loader (2022.03.20 official build)
  tests/
    unit/               Vitest tests (no browser needed)
    e2e/                Playwright tests (real WASM renders)
  package.json
```

## Feature parity with the Python service

| Feature                                  | Python service     | Web build |
| ---------------------------------------- | ------------------ | --------- |
| Drawer/grid/printer settings             | ✅                  | ✅         |
| Draw / select / edit / delete tools      | ✅                  | ✅         |
| Body overflow editing                    | ✅                  | ✅         |
| Validation (collisions, bounds, bed)     | `backend/validate` | `src/validate.js` |
| Naive split with sealed cut walls        | `backend/main`     | `src/split.js` |
| STL export (single + zip)                | `/api/export/stl`  | JSZip in browser |
| Baseplate export with split              | `/api/export/baseplate` | JSZip in browser |
| Project bundle export                    | `/api/export/bundle` | JSZip in browser |
| JSON import / export                     | ✅                  | ✅         |
| Undo / redo                              | ✅                  | ✅         |

## Deploy to GitHub Pages

Push `web/` to GitHub on `main`. The workflow at
`.github/workflows/deploy-pages.yml` uploads `web/` as the Pages artifact.

In your repo settings → Pages, set the source to **GitHub Actions** (not a
branch). After the first deploy, the site will be at
`https://<user>.github.io/<repo>/`.

> **Note about routing:** because the workflow uploads only `web/` as the
> artifact, the deployed site root is the contents of `web/`. So
> `index.html` is at `/`, `src/cad.js` is at `/src/cad.js`, etc. — exactly
> matching the local dev setup.

## OpenSCAD-WASM notes

- Release: `2022.03.20` (the most recent prebuilt). Renders the kennetek
  Gridfinity library correctly; if the library ever requires newer SCAD
  features, swap the `.wasm` for a fresh build from
  https://github.com/openscad/openscad-wasm.
- Bundle is ~7.7 MB (`openscad.wasm`) + ~120 KB (loader). Cached on first
  visit by the browser.
- All SCAD includes are mounted into the WASM filesystem at the same paths
  they use locally (`/scad/...`, `/vendor/gridfinity-rebuilt-openscad/...`),
  so the `use <../vendor/...>` directives resolve identically.
