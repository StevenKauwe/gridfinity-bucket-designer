# Gridfinity Bucket Designer

Browser-based designer for Gridfinity-compatible drawer organizers, with
separate **base footprint** (Gridfinity locking area) and **body footprint**
(usable bucket shape). Body can overflow the base; the wall + stackable lip
continue around the overflow region as if it were the same bucket.

## Two builds

| Build  | Where           | Render                                  |
| ------ | --------------- | --------------------------------------- |
| Server | `backend/` + `frontend/` | OpenSCAD CLI subprocess          |
| Web    | `web/`          | openscad-wasm in the browser, no backend |

The `web/` build is a feature-parity port that runs entirely client-side and
deploys to GitHub Pages — see [`web/README.md`](web/README.md).

## Stack

- **Backend** — `uv` + FastAPI + Pydantic + numpy-stl + OpenSCAD subprocess
- **Frontend** — vanilla HTML / CSS / SVG / JS (no build step)
- **CAD correctness baseline** — vendored
  [kennetek/gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad)
  (MIT)

## Setup

```bash
# 1. Install OpenSCAD (any 2021+ build works; snapshot recommended on Apple Silicon)
brew install --cask openscad@snapshot
# 2. Pull the SCAD library submodule
git submodule update --init --recursive
# 3. Python deps
uv sync
# 4. Run the server
uv run uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000.

> If OpenSCAD is not installed the server still runs — exports fall back to a
> hand-rolled triangle generator with approximate geometry. Install OpenSCAD
> for spec-correct output.

## Render paths

`backend/cad.py` selects one of three paths per bucket:

| Path     | When                                    | Renderer                                                    |
| -------- | --------------------------------------- | ----------------------------------------------------------- |
| Standard | `body_mm` matches `base_cells × cell`   | `backend/scad/standard.scad` (kennetek `bin_render`)         |
| Overflow | Body extends beyond base footprint      | `backend/scad/overflow.scad` (kennetek `gridfinityBase` + `render_wall`) |
| Fallback | OpenSCAD missing                        | `backend/legacy_cad.py` (hand-rolled triangles)              |

For overflow buckets, `gridfinityBase` places the spec-correct foot per base
cell, and `render_wall` sweeps the spec stacking lip around the body
rectangle. The wall is the same kennetek profile in the overflow region as
in the base region — it just terminates against the floor where there is no
foot below.

## Tests

```bash
uv run pytest
```

29 tests cover validation, naive split logic, model round-trip, FastAPI
surface, legacy fallback, and OpenSCAD-rendered geometry (winding-consistent
mesh, expected bounding box, magnet-hole / lip toggle effects).

OpenSCAD-dependent tests skip cleanly when the binary is unavailable.

## Layout

```
backend/
  cad.py            Render dispatcher (selects path)
  cad_openscad.py   (folded into cad.py)
  legacy_cad.py     Hand-rolled triangle generator (fallback)
  main.py           FastAPI app + naive split logic
  models.py         Pydantic schema
  openscad.py       Subprocess wrapper around `openscad` CLI
  scad/
    standard.scad   Wraps kennetek bin_render with body-local origin
    overflow.scad   Composes kennetek primitives for overflow buckets
  validate.py       Bounds + collision + printer-bed checks
frontend/
  index.html        Toolbar / tools / canvas / properties panel
  app.js            SVG editor, state, undo/redo, export wiring
  style.css
tests/              Pytest suite (skips OpenSCAD tests if not installed)
vendor/
  gridfinity-rebuilt-openscad/   Submodule (MIT) — geometric source of truth
```

## Bucket properties (forwarded to the renderer)

| Field                 | Effect                                                |
| --------------------- | ----------------------------------------------------- |
| `height_mm`           | Total external height in mm (includes stackable lip)  |
| `include_lip`         | Toggle the stackable top lip                          |
| `magnet_holes`        | 6 × 2 mm magnet pockets in each base foot             |
| `screw_holes`         | M3 screw holes in each base foot                      |
| `only_corners_holes`  | Place magnet/screw holes at corners only              |
| `scoop` (0–1)         | Scoop ramp inside the compartment (standard path)     |
| `style_tab` (0–5)     | Label tab style: 0=Full 1=Auto 2=L 3=C 4=R 5=None     |
| `wall_thickness_mm`   | Outer wall thickness (overflow path only)             |
| `floor_thickness_mm`  | Floor thickness above foot (overflow path only)       |

## API

| Method | Route                | Purpose                                     |
| ------ | -------------------- | ------------------------------------------- |
| POST   | `/api/validate`      | Returns `{valid, issues[]}` for the project |
| POST   | `/api/export/stl`    | STL for selected bucket(s); zip if multiple |
| POST   | `/api/export/bundle` | Zip of `project.json` + all STLs            |

## License notes

The SCAD library under `vendor/gridfinity-rebuilt-openscad/` is MIT-licensed
by Kenneth Hodson; original Gridfinity dimensions by Zack Freedman /
Voidstar Lab LLC.
