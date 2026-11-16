from typing import List, Optional
from pydantic import BaseModel, Field


class RcloneRemoteItem(BaseModel):
    name: str = Field(..., description="Remote name without trailing colon")
    type: Optional[str] = Field(default=None, description="Remote storage backend type, e.g. drive, s3, mega")


class RcloneConfigResponse(BaseModel):
    configured: bool = Field(..., description="Whether a valid rclone configuration exists")
    file_path: Optional[str] = Field(default=None, description="File path of rclone.conf on the system")
    file_size: int = Field(default=0, description="Size of rclone.conf in bytes")
    modified_at: Optional[float] = Field(default=None, description="Timestamp when rclone.conf was last modified")
    remotes: List[str] = Field(default_factory=list, description="List of configured remote names")
    remotes_detail: List[RcloneRemoteItem] = Field(default_factory=list, description="Detailed list of remotes with their types")
    message: Optional[str] = Field(default=None, description="Status or error message")


class RcloneUrlRequest(BaseModel):
    url: str = Field(..., min_length=1, description="Raw GitHub, Gist, or direct URL containing rclone.conf content")
