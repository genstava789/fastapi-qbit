from typing import List, Optional
from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status
from app.schemas.torrent import (
    AddMagnetRequest,
    TorrentActionResponse,
    TorrentItemResponse,
)
from app.services.qbit_service import qbit_service

router = APIRouter()


@router.post(
    "/add-magnet",
    response_model=TorrentActionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add Magnet Link",
    description="Add a new torrent download via magnet URI link.",
)
def add_magnet(payload: AddMagnetRequest):
    try:
        result = qbit_service.add_magnet(
            magnet_url=payload.magnet_url,
            save_path=payload.save_path,
            category=payload.category,
            is_paused=payload.is_paused,
            tags=payload.tags,
        )
        if "Ok" in result or "ok" in result.lower():
            return TorrentActionResponse(
                success=True,
                message="Magnet link successfully queued for download.",
                data={"result": result, "category": payload.category},
            )
        else:
            return TorrentActionResponse(
                success=False,
                message=f"Could not add magnet link (it may already exist in your download queue: '{result}').",
                data={"result": result},
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add magnet link: {str(e)}",
        )


@router.post(
    "/add-file",
    response_model=TorrentActionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload .torrent File",
    description="Add a new torrent download by uploading a .torrent file directly.",
)
async def add_torrent_file(
    file: UploadFile = File(..., description="The .torrent file to upload"),
    save_path: Optional[str] = Form(default=None, description="Custom save path on server"),
    category: Optional[str] = Form(default=None, description="Category name"),
    is_paused: bool = Form(default=False, description="Add torrent in paused state"),
):
    if not file.filename or not file.filename.endswith(".torrent"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must have a .torrent extension.",
        )
    try:
        content = await file.read()
        result = qbit_service.add_torrent_file(
            torrent_file_bytes=content,
            save_path=save_path,
            category=category,
            is_paused=is_paused,
        )
        if "Ok" in result or "ok" in result.lower():
            return TorrentActionResponse(
                success=True,
                message=f"Torrent file '{file.filename}' successfully queued.",
                data={"result": result, "filename": file.filename},
            )
        else:
            return TorrentActionResponse(
                success=False,
                message=f"Could not add torrent file (it may already exist: '{result}').",
                data={"result": result},
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add torrent file: {str(e)}",
        )


@router.get(
    "",
    response_model=List[TorrentItemResponse],
    summary="List Torrents",
    description="Get list of torrents currently managed by qBittorrent.",
)
def list_torrents(
    status_filter: Optional[str] = Query(
        default=None,
        description="Filter by state (e.g., downloading, completed, paused, active, inactive)",
    ),
    category: Optional[str] = Query(default=None, description="Filter by category"),
    tag: Optional[str] = Query(default=None, description="Filter by tag"),
):
    try:
        return qbit_service.list_torrents(
            status_filter=status_filter,
            category=category,
            tag=tag,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch torrents: {str(e)}",
        )


@router.get(
    "/{torrent_hash}",
    response_model=TorrentItemResponse,
    summary="Get Torrent Details",
    description="Retrieve details and progress for a single torrent by its hash.",
)
def get_torrent(torrent_hash: str):
    try:
        torrent = qbit_service.get_torrent(torrent_hash)
        if not torrent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Torrent with hash '{torrent_hash}' not found.",
            )
        return torrent
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve torrent: {str(e)}",
        )


@router.post(
    "/{torrent_hash}/pause",
    response_model=TorrentActionResponse,
    summary="Pause Torrent",
    description="Pause an active torrent download.",
)
def pause_torrent(torrent_hash: str):
    try:
        qbit_service.pause_torrent(torrent_hash)
        return TorrentActionResponse(
            success=True,
            message=f"Torrent '{torrent_hash}' has been paused.",
            data={"hash": torrent_hash},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to pause torrent: {str(e)}",
        )


@router.post(
    "/{torrent_hash}/resume",
    response_model=TorrentActionResponse,
    summary="Resume Torrent",
    description="Resume a paused torrent.",
)
def resume_torrent(torrent_hash: str):
    try:
        qbit_service.resume_torrent(torrent_hash)
        return TorrentActionResponse(
            success=True,
            message=f"Torrent '{torrent_hash}' has been resumed.",
            data={"hash": torrent_hash},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to resume torrent: {str(e)}",
        )


@router.delete(
    "/{torrent_hash}",
    response_model=TorrentActionResponse,
    summary="Delete Torrent",
    description="Remove a torrent from qBittorrent, optionally deleting downloaded data files.",
)
def delete_torrent(
    torrent_hash: str,
    delete_files: bool = Query(
        default=False,
        description="If true, permanently delete downloaded files on disk.",
    ),
):
    try:
        qbit_service.delete_torrent(torrent_hash, delete_files=delete_files)
        return TorrentActionResponse(
            success=True,
            message=f"Torrent '{torrent_hash}' deleted successfully (delete_files={delete_files}).",
            data={"hash": torrent_hash, "delete_files": delete_files},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete torrent: {str(e)}",
        )


@router.get(
    "/{torrent_hash}/export",
    summary="Download .torrent File",
    description="Export and download the .torrent metainfo file for a torrent.",
)
def export_torrent(torrent_hash: str):
    try:
        content = qbit_service.export_torrent_file(torrent_hash)
        torrent = qbit_service.get_torrent(torrent_hash)
        filename = f"{torrent['name']}.torrent" if torrent else f"{torrent_hash}.torrent"
        return Response(
            content=content,
            media_type="application/x-bittorrent",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export torrent: {str(e)}",
        )

