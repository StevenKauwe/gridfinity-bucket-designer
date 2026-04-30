# Deploying to GitHub Pages

## One-time setup

1. Push the repo to your personal GitHub.
2. In repo **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. The `.github/workflows/deploy-pages.yml` workflow will:
   - Upload the `web/` directory as the Pages artifact
   - Deploy it
4. Wait ~1 min, then visit `https://<your-username>.github.io/<repo-name>/`.

## Local preview before pushing

```bash
cd web
python3 -m http.server 8000
# open http://127.0.0.1:8000
```

## Verifying it works

1. Open the deployed URL.
2. Draw a 2×2 base in the canvas.
3. Click **Export STL (selected)** — the button shows "Rendering…" while
   openscad-wasm runs (~5–10 s on first export, faster after WASM is cached).
4. Open the downloaded `.stl` in a slicer.

## What gets deployed

- All static files in `web/` (HTML, CSS, JS, SCAD, vendored kennetek + WASM)
- Approx. 10 MB total (mostly `openscad.wasm` at 7.7 MB, cached after first
  visit)

## What does NOT get deployed

- The Python backend (`backend/`, `tests/`, `pyproject.toml`)
- `node_modules`, test reports, etc. (excluded by `.gitignore`)

The browser build is fully self-contained.
