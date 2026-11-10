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


class TorrentActionResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class HealthResponse(BaseModel):
    status: str
    app_version: str
    qbittorrent_connected: bool
    qbittorrent_version: Optional[str] = None

