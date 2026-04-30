#!/usr/bin/env python3
"""Pre-render common Gridfinity bin and baseplate configs to STL.

Output files live at web/cache/<scad-stem>/<sha256>.stl. The browser-side
cache (web/src/cad.js) computes the same SHA-256 of the SCAD param dict and
fetches the file before falling through to openscad-wasm — instant exports
for any config in this manifest.

Run with the repo's Python env (`uv run python web/scripts/precompute.py`)
once the kennetek submodule is present and OpenSCAD is installed.

The set of (gridx, gridy, gridz, magnet_holes) combos can be extended below
without touching the dispatcher; the JS side just looks up by hash.
"""
from __future__ import annotations

import gzip
import hashlib
import itertools
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from backend.cad import _bounding_grid_and_cut, _standard_params  # type: ignore
from backend.models import Bucket, Drawer, Project, RectCells, RectMM  # type: ignore
from backend.openscad import find_openscad, render_stl  # type: ignore

WEB_CACHE = REPO / "web" / "cache"
STANDARD_SCAD = REPO / "web" / "scad" / "standard.scad"
BASEPLATE_SCAD = REPO / "web" / "scad" / "baseplate.scad"


def fmt_param(v) -> str:
    """Match JS formatParam in web/src/cad.js (cache key formatting)."""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        s = f"{v:.6f}".rstrip("0").rstrip(".")
        return s if s else "0"
    if isinstance(v, list):
        return "[" + ",".join(fmt_param(x) for x in v) + "]"
    return json.dumps(v)


def cache_key(scad_rel: str, params: dict) -> str:
    """SHA-256 of the canonical scad_path + sorted params, hex digest."""
    keys = sorted(params)
    sig = f"{scad_rel}::" + "|".join(f"{k}={fmt_param(params[k])}" for k in keys)
    return hashlib.sha256(sig.encode()).hexdigest()


def write_cache(scad_rel: str, params: dict, scad_abs: Path) -> tuple[bool, Path]:
    """Render and gzip a single STL into the cache. Browser decompresses
    via DecompressionStream — see web/src/cad.js."""
    key = cache_key(scad_rel, params)
    stem = scad_abs.stem
    out = WEB_CACHE / stem / f"{key}.stl.gz"
    if out.exists():
        return False, out  # already cached
    out.parent.mkdir(parents=True, exist_ok=True)
    data = render_stl(scad_abs, params)
    out.write_bytes(gzip.compress(data, compresslevel=9))
    return True, out


def project_for_bucket() -> Project:
    return Project(drawer=Drawer(width_mm=500, depth_mm=420, height_mm=80))


def precompute_buckets() -> int:
    """Render the standard bins users hit most. Tweak the ranges to taste."""
    project = project_for_bucket()
    written = 0
    skipped = 0

    # 1×1 .. 6×6, three common heights, magnets on/off, lip on (default).
    grid_sizes = [(gx, gy) for gx in range(1, 7) for gy in range(1, 7)]
    heights = [21.0, 42.0, 56.0]  # 3u, 6u, 8u
    magnet_options = [False, True]

    total = len(grid_sizes) * len(heights) * len(magnet_options)
    for i, ((gx, gy), h, magnet) in enumerate(
        itertools.product(grid_sizes, heights, magnet_options), start=1,
    ):
        bucket = Bucket(
            id="precompute",
            base_cells=RectCells(x=0, y=0, w=gx, d=gy),
            body_mm=RectMM(x=0, y=0, w=gx * 42.0, d=gy * 42.0),
            height_mm=h,
            magnet_holes=magnet,
        )
        grid_w, grid_d, cut = _bounding_grid_and_cut(bucket, project)
        params = _standard_params(bucket, project, grid_w, grid_d, cut)
        # JS uses scadPath = "scad/standard.scad" (relative to the site root).
        wrote, out = write_cache("scad/standard.scad", params, STANDARD_SCAD)
        tag = "wrote" if wrote else "cache"
        print(f"[{i:>3}/{total}] {tag} {gx}×{gy} h={h:>4} magnet={magnet} → {out.name}")
        if wrote: written += 1
        else: skipped += 1
    return written


def precompute_baseplates() -> int:
    """Plain baseplates, 1×1 .. 6×6."""
    written = 0
    for gx in range(1, 7):
        for gy in range(1, 7):
            params = {
                "gridx": gx,
                "gridy": gy,
                "cell_mm": 42.0,
                "style_plate": 0,
                "style_hole": 0,
                "enable_magnet": False,
            }
            wrote, out = write_cache("scad/baseplate.scad", params, BASEPLATE_SCAD)
            tag = "wrote" if wrote else "cache"
            print(f"baseplate {gx}×{gy} {tag} → {out.name}")
            if wrote: written += 1
    return written


def main() -> int:
    if not find_openscad():
        print("ERROR: openscad CLI not found", file=sys.stderr)
        return 2
    if not STANDARD_SCAD.exists() or not BASEPLATE_SCAD.exists():
        print(f"ERROR: missing SCAD files under {STANDARD_SCAD.parent}", file=sys.stderr)
        return 2

    bw = precompute_buckets()
    bp = precompute_baseplates()
    print(f"\n✓ {bw} buckets + {bp} baseplates rendered. Cache at {WEB_CACHE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
