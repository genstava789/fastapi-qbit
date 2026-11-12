from typing import List, Optional

from pydantic import BaseModel, Field


class DriveAuthStatusResponse(BaseModel):
    authenticated: bool
    auth_url: Optional[str] = None


class DriveAuthCodeRequest(BaseModel):
    code: str = Field(..., description="OAuth authorization code from Google.")
    redirect_uri: Optional[str] = Field(default=None, description="Optional redirect URI used during auth.")


class DriveFileItem(BaseModel):
    id: str
    name: str
    mimeType: str
    size: Optional[int] = None
    modifiedTime: Optional[str] = None
    parents: Optional[List[str]] = None


class DriveListResponse(BaseModel):
    files: List[DriveFileItem]
    nextPageToken: Optional[str] = None


class DriveStorageQuota(BaseModel):
    limit: int
    usage: int
    usageInDrive: int
    usageInTrash: int
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    user_photo: Optional[str] = None


class DriveRenameFileRequest(BaseModel):
    name: str = Field(..., description="New name for the Google Drive file or folder.")


class DriveBatchDeleteRequest(BaseModel):
    file_ids: List[str] = Field(..., description="List of Google Drive file or folder IDs to delete.")


class DriveUploadRequest(BaseModel):
    file_path: Optional[str] = Field(default=None, description="Absolute path to the file on the server filesystem.")
    folder_id: str = Field(default="root", description="Google Drive folder ID to upload into.")
    torrent_hash: Optional[str] = Field(default=None, description="Optional torrent hash to auto-resolve content path from qBittorrent.")


class DriveUploadProgress(BaseModel):
    upload_id: str
    filename: str
    progress_percent: float
    status: str
    bytes_uploaded: int
    total_bytes: int
    drive_file_id: Optional[str] = None
    torrent_hash: Optional[str] = None
    file_path: Optional[str] = None


class DriveCreateFolderRequest(BaseModel):
    name: str = Field(..., description="Name of the folder to create.")
    parent_id: str = Field(default="root", description="Parent folder ID in Google Drive.")


class DriveBreadcrumb(BaseModel):
    id: str
    name: str


class DriveDefaultPathRequest(BaseModel):
    folder_id: str = Field(..., description="Google Drive folder ID to use as default upload target.")
    folder_name: str = Field(..., description="Display name of the default upload folder.")


class DriveDefaultPathResponse(BaseModel):
    folder_id: Optional[str] = None
    folder_name: Optional[str] = None
