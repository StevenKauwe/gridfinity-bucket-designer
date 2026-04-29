from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Drawer(BaseModel):
    width_mm: float
    depth_mm: float
    height_mm: float = 80


class GridSettings(BaseModel):
    cell_mm: float = 42
    clearance_mm: float = 0.25
    origin_x_mm: float = 0
    origin_y_mm: float = 0


class PrinterSettings(BaseModel):
    bed_x_mm: float = 256
    bed_y_mm: float = 256
    bed_z_mm: float = 256


class BucketDefaults(BaseModel):
    wall_thickness_mm: float = 1.6
    floor_thickness_mm: float = 1.2
    corner_radius_mm: float = 3
    bucket_height_mm: float = 60


class RectCells(BaseModel):
    x: int
    y: int
    w: int
    d: int


class RectMM(BaseModel):
    x: float
    y: float
    w: float
    d: float


class LabelSettings(BaseModel):
    enabled: bool = False
    text: str = ""
    style: Literal["front-scoop", "none"] = "front-scoop"


class ConnectorSettings(BaseModel):
    enabled: bool = False
    type: Literal["none", "dovetail", "pins", "magnets", "bolts"] = "none"


class SplitPart(BaseModel):
    id: str
    bounds_mm: RectMM
    connectors: list[str] = Field(default_factory=list)


class SplitSettings(BaseModel):
    enabled: bool = False
    strategy: Literal["auto", "manual", "naive"] = "auto"
    parts: list[SplitPart] = Field(default_factory=list)


class Bucket(BaseModel):
    id: str
    name: str = ""
    base_cells: RectCells
    body_mm: RectMM
    height_mm: float = 60
    wall_thickness_mm: float = 1.6
    floor_thickness_mm: float = 1.2
    corner_radius_mm: float = 3
    label: LabelSettings | None = None
    dividers: list[dict] = Field(default_factory=list)
    connectors: ConnectorSettings = Field(default_factory=ConnectorSettings)
    split: SplitSettings = Field(default_factory=SplitSettings)


class Project(BaseModel):
    version: str = "0.1.0"
    drawer: Drawer
    grid: GridSettings = Field(default_factory=GridSettings)
    printer: PrinterSettings = Field(default_factory=PrinterSettings)
    defaults: BucketDefaults = Field(default_factory=BucketDefaults)
    buckets: list[Bucket] = Field(default_factory=list)


class Issue(BaseModel):
    severity: Literal["error", "warning", "info"]
    bucket_id: str | None = None
    code: str
    message: str


class ValidateResponse(BaseModel):
    valid: bool
    issues: list[Issue]


class ExportRequest(BaseModel):
    project: Project
    bucket_ids: list[str] | None = None
