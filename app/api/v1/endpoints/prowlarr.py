from typing import List, Optional
from fastapi import APIRouter, Body, HTTPException, Query, status

from app.schemas.prowlarr import (
    ProwlarrAddRequest,
    ProwlarrConfigRequest,
    ProwlarrConfigResponse,
    ProwlarrSearchResult,
    ProwlarrTestRequest,
    ProwlarrTestResponse,
)
from app.schemas.torrent import TorrentActionResponse
from app.services.prowlarr_service import (
    ProwlarrNotConfiguredError,
    ProwlarrUpstreamError,
    prowlarr_service,
)
from app.services.qbit_service import is_add_torrent_success

router = APIRouter()


@router.get(
    "/config",
    response_model=ProwlarrConfigResponse,
    summary="Get Prowlarr Configuration",
    description="Return current Prowlarr base URL and masked API key status.",
)
def get_prowlarr_config():
    return prowlarr_service.get_config_status()


@router.put(
    "/config",
    response_model=ProwlarrConfigResponse,
    summary="Set Prowlarr Configuration",
    description="Save Prowlarr base URL and API key on the backend.",
)
@router.post(
    "/config",
    response_model=ProwlarrConfigResponse,
    include_in_schema=False,
)
def set_prowlarr_config(payload: ProwlarrConfigRequest):
    try:
        return prowlarr_service.set_config(url=payload.url, api_key=payload.api_key)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save Prowlarr configuration: {exc}",
        ) from exc


@router.delete(
    "/config",
    response_model=ProwlarrConfigResponse,
    summary="Clear Prowlarr Configuration",
    description="Remove saved runtime Prowlarr URL and API key.",
)
def clear_prowlarr_config():
    prowlarr_service.clear_config()
    return {
        **prowlarr_service.get_config_status(),
        "message": "Prowlarr configuration cleared.",
    }


@router.post(
    "/test",
    response_model=ProwlarrTestResponse,
    summary="Test Prowlarr Connection",
    description="Verify connectivity and API key against Prowlarr /api/v1/system/status.",
)
async def test_prowlarr_connection(payload: Optional[ProwlarrTestRequest] = Body(default=None)):
    try:
        return await prowlarr_service.test_connection(
            url=payload.url if payload else None,
            api_key=payload.api_key if payload else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ProwlarrNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ProwlarrUpstreamError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get(
    "/search",
    response_model=List[ProwlarrSearchResult],
    summary="Search Prowlarr Indexers",
    description="Execute a Prowlarr search query from the backend using the configured URL and API key.",
)
async def search_prowlarr(
    query: str = Query(..., min_length=1, description="Search query text"),
    search_type: str = Query(
        default="search",
        alias="type",
        description="Prowlarr search type (search, tvsearch, movie, music, book)",
    ),
    categories: Optional[List[int]] = Query(default=None, description="Optional category IDs"),
    indexer_ids: Optional[List[int]] = Query(default=None, description="Optional indexer IDs"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum number of results"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
):
    try:
        return await prowlarr_service.search(
            query=query,
            search_type=search_type,
            categories=categories,
            indexer_ids=indexer_ids,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ProwlarrNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ProwlarrUpstreamError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/add",
    response_model=TorrentActionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add Prowlarr Result to qBittorrent",
    description="Send a Prowlarr search result (magnet URI or .torrent download URL) directly to qBittorrent.",
)
async def add_prowlarr_result(payload: ProwlarrAddRequest):
    try:
        result, mode = await prowlarr_service.grab_to_qbit(
            magnet_url=payload.magnet_url,
            download_url=payload.download_url,
            save_path=payload.save_path,
            category=payload.category,
            is_paused=payload.is_paused,
        )
        if is_add_torrent_success(result):
            return TorrentActionResponse(
                success=True,
                message="Torrent successfully queued in qBittorrent.",
                data={"result": str(result), "mode": mode},
            )
        return TorrentActionResponse(
            success=False,
            message=f"Could not add torrent (it may already exist: '{result}').",
            data={"result": str(result), "mode": mode},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ProwlarrUpstreamError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add Prowlarr result to qBittorrent: {exc}",
        ) from exc

