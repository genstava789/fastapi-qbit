import logging
from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.schemas.rclone import RcloneConfigResponse, RcloneUrlRequest
from app.services.rclone_service import rclone_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/config",
    response_model=RcloneConfigResponse,
    summary="Get Rclone Configuration Status",
    description="Returns metadata about the active rclone.conf file and its configured remotes.",
)
def get_rclone_config():
    return rclone_service.get_config_status()


@router.post(
    "/config/url",
    response_model=RcloneConfigResponse,
    summary="Save Rclone Configuration from URL",
    description="Downloads rclone.conf from a raw GitHub or Gist URL and persists it.",
)
async def save_rclone_config_from_url(payload: RcloneUrlRequest):
    try:
        return await rclone_service.save_from_url(payload.url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error(f"Failed to fetch rclone config from url: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Terjadi kesalahan saat memproses URL: {exc}",
        ) from exc


@router.post(
    "/config/upload",
    response_model=RcloneConfigResponse,
    summary="Upload Rclone Configuration File",
    description="Uploads a local rclone.conf file and persists it to the server.",
)
async def upload_rclone_config_file(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        try:
            text = contents.decode("utf-8")
        except UnicodeDecodeError:
            text = contents.decode("latin-1", errors="replace")

        return rclone_service.save_from_file_content(text)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error(f"Failed to upload rclone config file: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengunggah file rclone.conf: {exc}",
        ) from exc


@router.delete(
    "/config",
    response_model=RcloneConfigResponse,
    summary="Delete Rclone Configuration",
    description="Removes the current rclone.conf file.",
)
def delete_rclone_config():
    return rclone_service.delete_config()
