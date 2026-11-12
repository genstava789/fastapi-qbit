import os
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from app.schemas.gdrive import (
    DriveAuthCodeRequest,
    DriveAuthStatusResponse,
    DriveBatchDeleteRequest,
    DriveBreadcrumb,
    DriveCreateFolderRequest,
    DriveDefaultPathRequest,
    DriveDefaultPathResponse,
    DriveFileItem,
    DriveListResponse,
    DriveRenameFileRequest,
    DriveStorageQuota,
    DriveUploadProgress,
    DriveUploadRequest,
)
from app.services.gdrive_service import gdrive_service

router = APIRouter()


# ── Auth ────────────────────────────────────────────────────────────────


@router.get(
    "/auth/status",
    response_model=DriveAuthStatusResponse,
    summary="Check Auth Status",
    description="Check whether the server holds a valid Google Drive OAuth token.",
)
def auth_status(redirect_uri: Optional[str] = Query(default=None)):
    authenticated = gdrive_service.is_authenticated()
    auth_url = None
    if not authenticated:
        try:
            auth_url = gdrive_service.get_auth_url(redirect_uri=redirect_uri)
        except Exception:
            auth_url = None
    return DriveAuthStatusResponse(authenticated=authenticated, auth_url=auth_url)


@router.get(
    "/auth/url",
    summary="Get Auth URL",
    description="Generate a Google OAuth authorization URL.",
)
def auth_url(redirect_uri: Optional[str] = Query(default=None)):
    try:
        url = gdrive_service.get_auth_url(redirect_uri=redirect_uri)
        return {"auth_url": url}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate auth URL: {str(e)}",
        )


@router.post(
    "/auth/callback",
    summary="Exchange Auth Code",
    description="Exchange an OAuth authorization code for access/refresh tokens.",
)
def auth_callback(payload: DriveAuthCodeRequest):
    try:
        success = gdrive_service.exchange_code(payload.code, redirect_uri=payload.redirect_uri)
        if success:
            return {"success": True, "message": "Google Drive authenticated successfully."}
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange authorization code. Check the code and try again.",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Auth callback failed: {str(e)}",
        )


@router.post(
    "/auth/logout",
    summary="Logout",
    description="Delete saved Google Drive OAuth token.",
)
def auth_logout():
    try:
        gdrive_service.logout()
        return {"success": True, "message": "Logged out of Google Drive."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to logout: {str(e)}",
        )


# ── Files & Folders ────────────────────────────────────────────────────


@router.get(
    "/files",
    response_model=DriveListResponse,
    summary="List Files",
    description="List files and folders in a Google Drive directory.",
)
def list_files(
    folder_id: str = Query(default="root", description="Drive folder ID to list contents of."),
    page_token: Optional[str] = Query(default=None, description="Pagination token for next page."),
):
    try:
        result = gdrive_service.list_files(folder_id=folder_id, page_token=page_token)
        return result
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list files: {str(e)}",
        )


@router.get(
    "/files/{file_id}/path",
    response_model=List[DriveBreadcrumb],
    summary="Get Folder Path",
    description="Build a breadcrumb path from a folder ID up to the root.",
)
def get_folder_path(file_id: str):
    try:
        path = gdrive_service.get_folder_path(file_id)
        return path
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get folder path: {str(e)}",
        )


@router.delete(
    "/files/{file_id}",
    summary="Delete File",
    description="Delete a file or folder from Google Drive.",
)
def delete_file(file_id: str):
    try:
        gdrive_service.delete_file(file_id)
        return {"success": True, "file_id": file_id, "message": "File deleted successfully."}
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete file: {str(e)}",
        )


@router.patch(
    "/files/{file_id}",
    summary="Rename File",
    description="Rename a file or folder in Google Drive.",
)
def rename_file(file_id: str, payload: DriveRenameFileRequest):
    try:
        updated = gdrive_service.rename_file(file_id, payload.name)
        return {"success": True, "file": updated}
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to rename file: {str(e)}",
        )


@router.post(
    "/files/batch-delete",
    summary="Batch Delete Files",
    description="Delete multiple files or folders from Google Drive.",
)
def batch_delete_files(payload: DriveBatchDeleteRequest):
    try:
        result = gdrive_service.batch_delete_files(payload.file_ids)
        return {"success": True, **result}
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to batch delete files: {str(e)}",
        )


# ── Storage ─────────────────────────────────────────────────────────────


@router.get(
    "/storage",
    response_model=DriveStorageQuota,
    summary="Get Storage Quota",
    description="Return Google Drive storage quota (limit, usage, in-drive, in-trash).",
)
def get_storage():
    try:
        return gdrive_service.get_storage_quota()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get storage quota: {str(e)}",
        )


@router.delete(
    "/trash",
    summary="Empty Trash",
    description="Permanently delete all files in Google Drive trash.",
)
def empty_trash():
    try:
        gdrive_service.empty_trash()
        return {"success": True, "message": "Google Drive trash emptied successfully."}
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to empty trash: {str(e)}",
        )


# ── Folders ──────────────────────────────────────────────────────────────


@router.post(
    "/folders",
    summary="Create Folder",
    description="Create a new folder in Google Drive.",
    status_code=status.HTTP_201_CREATED,
)
def create_folder(payload: DriveCreateFolderRequest):
    try:
        folder = gdrive_service.create_folder(name=payload.name, parent_id=payload.parent_id)
        return {"success": True, "folder": folder}
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create folder: {str(e)}",
        )


# ── Uploads ──────────────────────────────────────────────────────────────


@router.post(
    "/upload",
    summary="Start Upload",
    description="Start a resumable upload of a local server file to Google Drive.",
)
def start_upload(payload: DriveUploadRequest):
    if not payload.file_path and not payload.torrent_hash:
        raise HTTPException(
            status_code=getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422),
            detail="Either 'file_path' or 'torrent_hash' must be provided.",
        )
    try:
        upload_id = gdrive_service.start_resumable_upload(
            file_path=payload.file_path or "",
            folder_id=payload.folder_id,
            torrent_hash=payload.torrent_hash,
        )
        return {"success": True, "upload_id": upload_id, "message": "Upload started."}
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start upload: {str(e)}",
        )


@router.post(
    "/upload-file",
    summary="Upload File Directly",
    description="Upload a file directly from client machine to Google Drive.",
)
async def upload_file_direct(
    file: UploadFile = File(...),
    folder_id: str = Form(default="root"),
):
    import shutil
    import tempfile

    try:
        suffix = os.path.splitext(file.filename or "")[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            shutil.copyfileobj(file.file, tmp)

        # Start resumable upload on temp file
        upload_id = gdrive_service.start_resumable_upload(
            file_path=tmp_path,
            folder_id=folder_id,
        )
        # Fix the filename in upload state
        if upload_id in gdrive_service._uploads and file.filename:
            gdrive_service._uploads[upload_id].filename = file.filename

        return {
            "success": True,
            "upload_id": upload_id,
            "message": f"Upload for '{file.filename}' started.",
        }
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}",
        )


@router.get(
    "/upload/{upload_id}/progress",
    response_model=DriveUploadProgress,
    summary="Get Upload Progress",
    description="Get the progress of a specific upload by its upload_id.",
)
def get_upload_progress(upload_id: str):
    progress = gdrive_service.get_upload_progress(upload_id)
    if not progress:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Upload with id '{upload_id}' not found.",
        )
    return progress


@router.get(
    "/uploads",
    response_model=List[DriveUploadProgress],
    summary="List All Uploads",
    description="List all active and completed uploads with their progress.",
)
def list_uploads():
    return gdrive_service.get_all_uploads()


@router.delete(
    "/uploads/completed",
    summary="Clear Completed Uploads",
    description="Remove completed and failed uploads from the tracking list.",
)
def clear_completed_uploads():
    cleared = gdrive_service.clear_completed_uploads()
    return {"success": True, "cleared_count": cleared}


# ── Download ─────────────────────────────────────────────────────────────


@router.get(
    "/download/{file_id}",
    summary="Get Download URL",
    description="Get a download or export URL for a Google Drive file.",
)
def get_download_url(file_id: str):
    try:
        url = gdrive_service.download_file_url(file_id)
        return {"file_id": file_id, "download_url": url}
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get download URL: {str(e)}",
        )


@router.get(
    "/files/{file_id}/meta",
    response_model=DriveFileItem,
    summary="Get File Metadata",
    description="Get metadata for a single Google Drive file for previewing.",
)
def get_file_meta(file_id: str):
    try:
        return gdrive_service.get_file_metadata(file_id)
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch file metadata: {str(e)}",
        )


@router.get(
    "/token",
    summary="Get Drive Access Token Info",
    description="Returns valid Google Drive OAuth access token and client credentials for edge workers and direct proxies.",
)
def get_drive_access_token():
    try:
        return gdrive_service.get_access_token_info()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to obtain access token: {str(e)}",
        )


@router.get(
    "/stream/{file_id}",
    summary="Stream File Content",
    description="Stream file directly from Google Drive API with Range header support.",
)
def stream_file_content(file_id: str, request: Request):
    try:
        meta = gdrive_service.get_file_metadata(file_id)
        range_header = request.headers.get("Range")
        resp = gdrive_service.open_download_stream(file_id, range_header=range_header)

        if resp.status_code >= 400:
            error_body = resp.text
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Google Drive streaming error ({resp.status_code}): {error_body[:500]}",
            )

        filename = meta.get("name", "download")
        mime_type = meta.get("mimeType") or "application/octet-stream"

        from urllib.parse import quote
        safe_filename = quote(filename)
        response_headers = {
            "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{safe_filename}',
            "Content-Type": mime_type,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        }
        if "Content-Length" in resp.headers:
            response_headers["Content-Length"] = resp.headers["Content-Length"]
        if "Content-Range" in resp.headers:
            response_headers["Content-Range"] = resp.headers["Content-Range"]

        status_code = resp.status_code if resp.status_code in (200, 206) else 200

        def iterfile():
            try:
                for chunk in resp.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        yield chunk
            finally:
                resp.close()

        return StreamingResponse(
            iterfile(),
            status_code=status_code,
            headers=response_headers,
            media_type=mime_type,
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stream file: {str(e)}",
        )


# ── Default Path ─────────────────────────────────────────────────────────


@router.get(
    "/default-path",
    response_model=DriveDefaultPathResponse,
    summary="Get Default Upload Path",
    description="Get the saved default Google Drive upload folder.",
)
def get_default_path():
    result = gdrive_service.get_default_path()
    return result


@router.post(
    "/default-path",
    response_model=DriveDefaultPathResponse,
    summary="Set Default Upload Path",
    description="Save a default Google Drive upload folder.",
)
def set_default_path(payload: DriveDefaultPathRequest):
    try:
        gdrive_service.set_default_path(folder_id=payload.folder_id, folder_name=payload.folder_name)
        return DriveDefaultPathResponse(
            folder_id=payload.folder_id,
            folder_name=payload.folder_name,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save default path: {str(e)}",
        )
