from typing import List, Optional
from urllib.parse import urlparse
from pydantic import BaseModel, Field, field_validator


def validate_http_url(url: str) -> str:
    """Validate and normalize an HTTP/HTTPS URL, stripping trailing slashes and redundant /api/v1."""
    trimmed = url.strip().rstrip("/")
    parsed = urlparse(trimmed)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Invalid URL: must start with http:// or https:// and include a host.")
    for suffix in ("/api/v1", "/api"):
        if trimmed.endswith(suffix):
            trimmed = trimmed[:-len(suffix)].rstrip("/")
    return trimmed


def sanitize_api_key(v: Optional[str]) -> Optional[str]:
    """Sanitize API key input, stripping quotes and treating masked keys as None."""
    if v is None:
        return None
    stripped = v.strip().strip('"').strip("'")
    if not stripped:
        return None
    if "*" in stripped:
        return None
    return stripped


class ProwlarrConfigRequest(BaseModel):
    url: str = Field(
        ...,
        description="Base URL of your Prowlarr instance (e.g. http://127.0.0.1:9696 or https://prowlarr.example.com)",
        examples=["https://prowlarr.example.com"],
    )
    api_key: Optional[str] = Field(
        default=None,
        description="Prowlarr API Key. Required on initial setup; omit or leave blank to keep existing key when updating URL.",
    )

    @field_validator("url")
    @classmethod
    def check_url(cls, v: str) -> str:
        return validate_http_url(v)

    @field_validator("api_key")
    @classmethod
    def check_api_key(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_api_key(v)


class ProwlarrConfigResponse(BaseModel):
    configured: bool
    url: Optional[str] = None
    has_api_key: bool = False
    api_key_masked: Optional[str] = None
    message: Optional[str] = None


class ProwlarrTestRequest(BaseModel):
    url: Optional[str] = Field(
        default=None,
        description="Optional Prowlarr URL to test before saving. Uses saved URL if omitted.",
    )
    api_key: Optional[str] = Field(
        default=None,
        description="Optional Prowlarr API Key to test before saving. Uses saved key if omitted.",
    )

    @field_validator("url")
    @classmethod
    def check_optional_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        return validate_http_url(v)

    @field_validator("api_key")
    @classmethod
    def check_optional_api_key(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_api_key(v)


class ProwlarrTestResponse(BaseModel):
    connected: bool
    version: Optional[str] = None
    app_name: Optional[str] = None
    message: str


class ProwlarrSearchResult(BaseModel):
    title: str
    size: int = 0
    seeders: int = 0
    leechers: int = 0
    magnetUrl: Optional[str] = None
    downloadUrl: Optional[str] = None
    infoUrl: Optional[str] = None
    indexer: str = "Unknown"
    publishDate: str = ""
    categories: List[str] = Field(default_factory=list)
    guid: Optional[str] = None


class ProwlarrAddRequest(BaseModel):
    magnet_url: Optional[str] = Field(default=None, description="Direct magnet URI from Prowlarr result.")
    download_url: Optional[str] = Field(
        default=None,
        description="Prowlarr download URL used when magnet_url is unavailable (supports redirects to magnet or .torrent files).",
    )
    save_path: Optional[str] = Field(default=None, description="Optional custom save path.")
    category: Optional[str] = Field(default=None, description="Optional qBittorrent category.")
    is_paused: bool = Field(default=False, description="Whether to add the torrent paused.")

