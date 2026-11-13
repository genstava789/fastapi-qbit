import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from app.core.config import settings
from app.schemas.prowlarr import ProwlarrSearchResult, validate_http_url
from app.services.qbit_service import qbit_service

logger = logging.getLogger(__name__)


class ProwlarrNotConfiguredError(RuntimeError):
    """Raised when Prowlarr URL or API key has not been configured."""


class ProwlarrUpstreamError(RuntimeError):
    """Raised when communicating with the Prowlarr server fails."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _clean_api_key(api_key: Optional[str]) -> Optional[str]:
    """Clean and validate an API key, treating masked values with asterisks as None."""
    if not api_key or not isinstance(api_key, str):
        return None
    cleaned = api_key.strip().strip('"').strip("'")
    if not cleaned or "*" in cleaned:
        return None
    return cleaned


def mask_api_key(api_key: Optional[str]) -> Optional[str]:
    """Return a masked representation of the API key for safe display."""
    if not api_key:
        return None
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}{'*' * (len(api_key) - 8)}{api_key[-4:]}"


def _extract_categories(raw_categories: Any) -> List[str]:
    """Normalize Prowlarr category entries (objects or strings) into display names."""
    if not isinstance(raw_categories, list):
        return []
    names: List[str] = []
    for item in raw_categories:
        if isinstance(item, dict):
            label = item.get("name") or (str(item["id"]) if item.get("id") is not None else "")
        else:
            label = str(item) if item is not None else ""
        if label:
            names.append(label)
    return names


def _is_same_origin(base_url: str, target_url: str) -> bool:
    """Return True if target_url shares scheme and netloc with base_url."""
    base = urlparse(base_url)
    target = urlparse(target_url)
    return base.scheme == target.scheme and base.netloc == target.netloc


class ProwlarrService:
    """Manages Prowlarr configuration persistence, search queries, and download grabs."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def _get_settings_path(self) -> str:
        return os.getenv("PROWLARR_SETTINGS_FILE", settings.PROWLARR_SETTINGS_FILE)

    def _read_settings_file(self) -> Dict[str, Any]:
        path = self._get_settings_path()
        if not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as exc:
            logger.warning(f"Failed to read Prowlarr settings file '{path}': {exc}")
            return {}

    def get_raw_config(self) -> Tuple[Optional[str], Optional[str]]:
        """Return the active (url, api_key) pair from persisted settings or env defaults."""
        with self._lock:
            saved = self._read_settings_file()

        raw_url = saved.get("url") or settings.PROWLARR_URL
        raw_key = saved.get("api_key") or settings.PROWLARR_API_KEY

        url: Optional[str] = None
        if isinstance(raw_url, str) and raw_url.strip():
            url = raw_url.strip().rstrip("/")

        api_key = raw_key.strip() if isinstance(raw_key, str) and raw_key.strip() else None
        return url, api_key

    def get_config_status(self) -> Dict[str, Any]:
        """Return safe configuration metadata without exposing the raw API key."""
        url, api_key = self.get_raw_config()
        return {
            "configured": bool(url and api_key),
            "url": url,
            "has_api_key": bool(api_key),
            "api_key_masked": mask_api_key(api_key),
        }

    def set_config(self, url: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """Validate and persist Prowlarr URL and API key."""
        normalized_url = validate_http_url(url)
        _, existing_key = self.get_raw_config()
        clean_input_key = _clean_api_key(api_key)
        resolved_key = clean_input_key if clean_input_key else existing_key
        if not resolved_key:
            raise ValueError("Prowlarr API key is required.")

        path = self._get_settings_path()
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)

        with self._lock:
            payload = self._read_settings_file()
            payload["url"] = normalized_url
            payload["api_key"] = resolved_key
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)

        return {
            **self.get_config_status(),
            "message": "Prowlarr configuration saved.",
        }

    def clear_config(self) -> None:
        """Remove persisted Prowlarr runtime settings."""
        path = self._get_settings_path()
        with self._lock:
            if os.path.exists(path):
                os.remove(path)

    def _require_config(self) -> Tuple[str, str]:
        url, api_key = self.get_raw_config()
        if not url or not api_key:
            raise ProwlarrNotConfiguredError(
                "Prowlarr is not configured. Set the Prowlarr URL and API key first."
            )
        return url, api_key

    def _normalize_search_item(self, item: Dict[str, Any]) -> ProwlarrSearchResult:
        guid = str(item.get("guid") or "").strip()
        magnet_url = item.get("magnetUrl") or None
        download_url = item.get("downloadUrl") or None

        if guid.startswith("magnet:?"):
            if magnet_url and not magnet_url.startswith("magnet:?") and not download_url:
                download_url = magnet_url
            magnet_url = guid
        elif not magnet_url and isinstance(download_url, str) and download_url.startswith("magnet:?"):
            magnet_url = download_url
        elif magnet_url and not magnet_url.startswith("magnet:?"):
            if not download_url:
                download_url = magnet_url
            magnet_url = None

        return ProwlarrSearchResult(
            title=str(item.get("title") or "Untitled"),
            size=int(item.get("size") or 0),
            seeders=int(item.get("seeders") or 0),
            leechers=int(item.get("leechers") or 0),
            magnetUrl=magnet_url,
            downloadUrl=download_url,
            infoUrl=item.get("infoUrl") or None,
            indexer=str(item.get("indexer") or "Unknown"),
            publishDate=str(item.get("publishDate") or ""),
            categories=_extract_categories(item.get("categories")),
            guid=item.get("guid") or None,
        )

    async def test_connection(
        self, url: Optional[str] = None, api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """Verify connectivity and authentication against Prowlarr system status."""
        saved_url, saved_key = self.get_raw_config()
        target_url = validate_http_url(url) if url else saved_url
        clean_input_key = _clean_api_key(api_key)
        target_key = clean_input_key if clean_input_key else saved_key

        if not target_url or not target_key:
            raise ProwlarrNotConfiguredError(
                "Both Prowlarr URL and API key are required to test the connection."
            )

        endpoint = f"{target_url}/api/v1/system/status"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    endpoint,
                    headers={"X-Api-Key": target_key},
                    params={"apikey": target_key},
                )
        except httpx.TimeoutException as exc:
            raise ProwlarrUpstreamError("Connection to Prowlarr timed out.", status_code=504) from exc
        except httpx.RequestError as exc:
            raise ProwlarrUpstreamError(
                f"Failed to connect to Prowlarr at {target_url}: {exc}", status_code=502
            ) from exc

        if response.status_code in (401, 403):
            raise ProwlarrUpstreamError("Prowlarr rejected the API key.", status_code=502)
        if response.status_code >= 400:
            raise ProwlarrUpstreamError(
                f"Prowlarr returned HTTP {response.status_code}.", status_code=502
            )

        data = response.json() if response.content else {}
        return {
            "connected": True,
            "version": data.get("version"),
            "app_name": data.get("appName") or "Prowlarr",
            "message": "Connected to Prowlarr successfully.",
        }

    async def search(
        self,
        query: str,
        search_type: str = "search",
        categories: Optional[List[int]] = None,
        indexer_ids: Optional[List[int]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[ProwlarrSearchResult]:
        """Search indexers through the configured Prowlarr instance."""
        trimmed_query = query.strip()
        if not trimmed_query:
            raise ValueError("Search query must not be empty.")

        base_url, api_key = self._require_config()
        params: List[Tuple[str, str]] = [
            ("query", trimmed_query),
            ("type", search_type),
            ("limit", str(limit)),
            ("offset", str(offset)),
            ("apikey", api_key),
        ]
        for category_id in categories or []:
            params.append(("categories", str(category_id)))
        for indexer_id in indexer_ids or []:
            params.append(("indexerIds", str(indexer_id)))

        endpoint = f"{base_url}/api/v1/search"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    endpoint,
                    params=params,
                    headers={"X-Api-Key": api_key},
                )
        except httpx.TimeoutException as exc:
            raise ProwlarrUpstreamError("Prowlarr search request timed out.", status_code=504) from exc
        except httpx.RequestError as exc:
            raise ProwlarrUpstreamError(
                f"Could not connect to Prowlarr: {exc}", status_code=502
            ) from exc

        if response.status_code in (401, 403):
            raise ProwlarrUpstreamError(
                "Prowlarr authentication failed: check your API key.", status_code=502
            )
        if response.status_code >= 400:
            raise ProwlarrUpstreamError(
                f"Prowlarr returned HTTP {response.status_code}.", status_code=502
            )

        raw_items = response.json()
        if not isinstance(raw_items, list):
            raise ProwlarrUpstreamError("Unexpected response format from Prowlarr.", status_code=502)

        return [
            self._normalize_search_item(item)
            for item in raw_items
            if isinstance(item, dict)
        ]

    async def grab_to_qbit(
        self,
        magnet_url: Optional[str] = None,
        download_url: Optional[str] = None,
        save_path: Optional[str] = None,
        category: Optional[str] = None,
        is_paused: bool = False,
    ) -> Tuple[str, str]:
        """Add a Prowlarr search result to qBittorrent via magnet URI or .torrent download."""
        if magnet_url and magnet_url.strip().startswith("magnet:?"):
            result = qbit_service.add_magnet(
                magnet_url=magnet_url.strip(),
                save_path=save_path,
                category=category,
                is_paused=is_paused,
            )
            return result, "magnet"

        candidate_download = (
            download_url
            or (magnet_url if magnet_url and not magnet_url.strip().startswith("magnet:?") else None)
        )
        if not candidate_download or not candidate_download.strip():
            raise ValueError("Either magnet_url or download_url is required.")

        current_url = candidate_download.strip()
        if current_url.startswith("magnet:?"):
            result = qbit_service.add_magnet(
                magnet_url=current_url,
                save_path=save_path,
                category=category,
                is_paused=is_paused,
            )
            return result, "magnet"

        base_url, api_key = self.get_raw_config()
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
                response: Optional[httpx.Response] = None
                for _ in range(5):
                    headers: Dict[str, str] = {}
                    if base_url and api_key and _is_same_origin(base_url, current_url):
                        headers["X-Api-Key"] = api_key

                    response = await client.get(current_url, headers=headers)
                    if response.is_redirect and "location" in response.headers:
                        location = response.headers["location"].strip()
                        if location.startswith("magnet:?"):
                            result = qbit_service.add_magnet(
                                magnet_url=location,
                                save_path=save_path,
                                category=category,
                                is_paused=is_paused,
                            )
                            return result, "magnet"
                        current_url = urljoin(current_url, location)
                        continue
                    break
        except httpx.TimeoutException as exc:
            raise ProwlarrUpstreamError("Timed out downloading torrent from Prowlarr.", status_code=504) from exc
        except httpx.RequestError as exc:
            raise ProwlarrUpstreamError(
                f"Failed to download torrent from Prowlarr: {exc}", status_code=502
            ) from exc

        if response is None or response.status_code >= 400 or not response.content:
            code = response.status_code if response is not None else 502
            raise ProwlarrUpstreamError(
                f"Failed to retrieve torrent payload (HTTP {code}).", status_code=502
            )

        result = qbit_service.add_torrent_file(
            torrent_file_bytes=response.content,
            save_path=save_path,
            category=category,
            is_paused=is_paused,
        )
        return result, "torrent_file"


prowlarr_service = ProwlarrService()

