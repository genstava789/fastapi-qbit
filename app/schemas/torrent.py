from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class AddMagnetRequest(BaseModel):
    magnet_url: str = Field(
        ...,
        description="The magnet URI link (starts with magnet:?)",
        examples=["magnet:?xt=urn:btih:3b245504cf5f11bbdbe1201cea6a6bf45a004e6d&dn=ubuntu.iso"],
    )
    save_path: Optional[str] = Field(
        default=None,
        description="Custom directory path to save the download. Defaults to server setting if empty.",
    )
    category: Optional[str] = Field(
        default=None,
        description="Category name for organizing torrents.",
    )
    is_paused: bool = Field(
        default=False,
        description="Whether to add the torrent in paused state.",
    )
    tags: Optional[List[str]] = Field(
        default=None,
        description="Optional list of tags.",
    )
    skip_checking: bool = Field(
        default=False,
        description="Skip hash checking when seeding existing local files (re-seed mode).",
    )
    auto_tmm: Optional[bool] = Field(
        default=None,
        description="Control Automatic Torrent Management (set false for custom local re-seed save_path).",
    )

    @field_validator("magnet_url")
    @classmethod
    def validate_magnet(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed.startswith("magnet:?"):
            raise ValueError("Invalid magnet URL: must start with 'magnet:?'")
        return trimmed


class TorrentItemResponse(BaseModel):
    hash: str
    name: str
    state: str
    progress: float
    total_size: int
    downloaded: int
    uploaded: int
    download_speed: int
    upload_speed: int
    eta: int
    save_path: str
    content_path: Optional[str] = None
    ratio: Optional[float] = None
    num_seeds: Optional[int] = 0
    num_complete: Optional[int] = 0
    num_leechs: Optional[int] = 0
    num_incomplete: Optional[int] = 0
    added_on: Optional[int] = 0


class TorrentActionResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class HealthResponse(BaseModel):
    status: str
    app_version: str
    qbittorrent_connected: bool
    qbittorrent_version: Optional[str] = None


class SystemStatsResponse(BaseModel):
    hostname: str
    os_name: str
    architecture: str
    active_user: str
    cpu_percent: float
    cpu_cores: int
    ram_used_bytes: int
    ram_total_bytes: int
    ram_percent: float
    disk_path: str
    disk_free_bytes: int
    disk_used_bytes: int
    disk_total_bytes: int
    disk_percent: float
    uptime_seconds: int
    public_ip: Optional[str] = None


class ServerPathItem(BaseModel):
    name: str
    path: str


class ServerPathsResponse(BaseModel):
    current_path: str
    parent_path: Optional[str] = None
    directories: List[ServerPathItem]
