import logging
from typing import Optional
from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse
import httpx
from app.core.config import settings

logger = logging.getLogger("webtorrent-proxy")

proxy_router = APIRouter()

EXCLUDE_REQ_HEADERS = {
    "host",
    "content-length",
    "connection",
    "keep-alive",
}

EXCLUDE_RESP_HEADERS = {
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
}

_async_client: Optional[httpx.AsyncClient] = None


def get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            base_url=f"http://{settings.qbit_base_url}",
            timeout=60.0,
            follow_redirects=False,
        )
    return _async_client


@proxy_router.api_route("/webtorrent", methods=["GET", "HEAD"], include_in_schema=False)
async def redirect_to_trailing_slash():
    """Ensure trailing slash so that relative CSS, JS, and API paths resolve properly."""
    return RedirectResponse(url="/webtorrent/", status_code=307)


@proxy_router.api_route(
    "/webtorrent/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"],
    include_in_schema=False,
)
async def webtorrent_proxy(request: Request, full_path: str = ""):
    client = get_async_client()
    target_path = f"/{full_path}"

    # Filter incoming request headers
    req_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in EXCLUDE_REQ_HEADERS
    }
    # qBittorrent expects local Host header
    req_headers["host"] = settings.qbit_base_url

    body = await request.body()

    try:
        resp = await client.request(
            method=request.method,
            url=target_path,
            params=request.query_params,
            headers=req_headers,
            content=body,
        )
    except Exception as e:
        logger.error(f"Error proxying request to qBittorrent: {e}")
        return Response(
            content=f"Error connecting to qBittorrent WebUI: {str(e)}",
            status_code=502,
            media_type="text/plain",
        )

    # Build header list for Starlette Response
    response = Response(
        content=resp.content,
        status_code=resp.status_code,
    )

    # Filter and copy headers
    for k, v in resp.headers.items():
        if k.lower() not in EXCLUDE_RESP_HEADERS and k.lower() != "set-cookie":
            response.headers[k] = v

    # Forward Set-Cookie headers
    for cookie in resp.headers.get_list("set-cookie"):
        response.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))

    # Handle internal redirects
    if "location" in resp.headers:
        loc = resp.headers["location"]
        if loc.startswith("/") and not loc.startswith("/webtorrent"):
            response.headers["location"] = f"/webtorrent{loc}"

    return response
