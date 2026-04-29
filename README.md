# Gridfinity Bucket Designer

Browser-based designer for Gridfinity-compatible drawer organizers, with separate
**base footprint** (Gridfinity locking area) and **body footprint** (usable bucket
shape) so bins can overflow the grid.

## Stack

- **Backend** — `uv` + FastAPI + Pydantic + numpy-stl
- **Frontend** — vanilla HTML / CSS / SVG / JS (no build step)

## Run

```bash
uv sync
uv run uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000.

## Layout

```
backend/
  main.py       FastAPI app + endpoints
  models.py     Pydantic project/bucket schema
  validate.py   Collision + bounds checks
  cad.py        STL generation (rectangular hollow shell + Gridfinity feet)
frontend/
  index.html    Toolbar / tools / canvas / properties panel
  app.js        SVG editor, state, undo/redo, export wiring
  style.css
```

## Tools

| Tool        | Behavior                                                      |
| ----------- | ------------------------------------------------------------- |
| Select      | Click a bucket to select; drag to move (snaps to grid cells). SE handle resizes the **base** in cells. |
| Draw Base   | Click-drag on empty canvas to draw a Gridfinity base footprint. New bucket gets `body_mm` matching base. |
| Edit Body   | When a bucket is selected, the SE handle resizes the **body** in mm independently of the base. |
| Delete      | Click a bucket to remove. (Or select + Backspace.)            |

Body offset / overflow can also be edited numerically in the right panel.

## API

| Method | Route                | Purpose                                     |
| ------ | -------------------- | ------------------------------------------- |
| POST   | `/api/validate`      | Returns `{valid, issues[]}` for the project |
| POST   | `/api/export/stl`    | STL for selected bucket(s); zip if multiple |
| POST   | `/api/export/bundle` | Zip of `project.json` + all STLs            |

## MVP scope (per spec §9.1)

Implemented: drawer dimensions, grid overlay, rectangular bucket draw, base/body
separation, body overflow, height/wall, JSON I/O, STL export, collision +
printer-bed validation, undo/redo.

Not yet: rounded corners in CAD output, label scoops, dividers, automatic
oversized-bucket splitting with connectors, polygon bodies, 3D preview.

The CAD output uses a simplified two-step Gridfinity foot profile (top 41.5 mm,
mid step at 37.2 mm, bottom 35.6 mm). The exact 0.8 / 1.8 / 2.15 mm chamfered
profile and rounded corners are TODO — currently the foot is stepped, not
chamfered, so it will not lock perfectly into a real Gridfinity baseplate
without slight tuning.
