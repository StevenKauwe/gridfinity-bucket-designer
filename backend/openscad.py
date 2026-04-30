"""Subprocess wrapper around the OpenSCAD CLI."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


class OpenSCADUnavailable(RuntimeError):
    """Raised when the OpenSCAD binary cannot be located on this host."""


class OpenSCADRenderError(RuntimeError):
    """Raised when the OpenSCAD subprocess returns non-zero."""


_DEFAULT_CANDIDATES = (
    "openscad",
    "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
    "/Applications/OpenSCAD-2021.01.app/Contents/MacOS/OpenSCAD",
)


def find_openscad() -> str | None:
    explicit = os.environ.get("OPENSCAD_BIN")
    if explicit:
        return explicit if Path(explicit).exists() else None
    for c in _DEFAULT_CANDIDATES:
        resolved = shutil.which(c) if "/" not in c else (c if Path(c).exists() else None)
        if resolved:
            return resolved
    return None


def openscad_version() -> str | None:
    binary = find_openscad()
    if not binary:
        return None
    try:
        out = subprocess.run(
            [binary, "--version"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        return (out.stdout + out.stderr).strip().splitlines()[0]
    except (subprocess.TimeoutExpired, OSError):
        return None


def _format_param(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        # quote string literal for SCAD
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_format_param(v) for v in value) + "]"
    raise TypeError(f"Unsupported SCAD param type: {type(value)!r}")


def render_stl(
    scad_path: str | Path,
    params: dict[str, Any] | None = None,
    *,
    timeout: float = 120.0,
) -> bytes:
    """Render an OpenSCAD file to a binary STL and return its bytes.

    Parameters override file-scope variables in the SCAD file via ``-D``.
    """
    binary = find_openscad()
    if not binary:
        raise OpenSCADUnavailable(
            "openscad CLI not found. Install via 'brew install --cask openscad' "
            "or set OPENSCAD_BIN to the binary path."
        )

    scad_path = Path(scad_path).resolve()
    if not scad_path.exists():
        raise FileNotFoundError(scad_path)

    with tempfile.TemporaryDirectory() as td:
        out_stl = Path(td) / "out.stl"
        cmd: list[str] = [binary, "-o", str(out_stl)]
        cmd += ["--export-format", "binstl"]
        for key, value in (params or {}).items():
            cmd += ["-D", f"{key}={_format_param(value)}"]
        cmd.append(str(scad_path))

        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False,
        )
        if proc.returncode != 0 or not out_stl.exists():
            raise OpenSCADRenderError(
                f"openscad failed (exit {proc.returncode}):\n{proc.stderr}\nCMD: {' '.join(cmd)}"
            )
        return out_stl.read_bytes()
