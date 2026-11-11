import logging
from typing import Any, Dict, List, Optional
import qbittorrentapi
from app.core.config import settings

logger = logging.getLogger(__name__)


class QBitService:
    def __init__(self) -> None:
        self._client: Optional[qbittorrentapi.Client] = None

    def get_client(self) -> qbittorrentapi.Client:
        """Returns an authenticated qbittorrent-api client instance."""
        if self._client is None:
            self._client = qbittorrentapi.Client(
                host=settings.qbit_base_url,
                username=settings.QBIT_USERNAME,
                password=settings.QBIT_PASSWORD,
                VERIFY_WEBUI_CERTIFICATE=settings.QBIT_VERIFY_WEBUI_CERTIFICATE,
            )
        try:
            # Test authentication or login if required
            self._client.auth_log_in()
        except qbittorrentapi.LoginFailed as e:
            logger.error(f"qBittorrent login failed: {e}")
            raise RuntimeError(f"qBittorrent authentication failed: {e}")
        except Exception as e:
            logger.warning(f"Connection test info: {e}")

        return self._client

    def check_connection(self) -> tuple[bool, Optional[str]]:
        """Checks if qBittorrent daemon is reachable and returns version."""
        try:
            client = self.get_client()
            version = client.app.version
            return True, version
        except Exception as e:
            logger.error(f"Failed to connect to qBittorrent: {e}")
            return False, None

    def add_magnet(
        self,
        magnet_url: str,
        save_path: Optional[str] = None,
        category: Optional[str] = None,
        is_paused: bool = False,
        tags: Optional[List[str]] = None,
        skip_checking: bool = False,
        auto_tmm: Optional[bool] = None,
    ) -> str:
        """Adds a torrent via magnet link to qBittorrent."""
        client = self.get_client()
        target_path = save_path or settings.DEFAULT_SAVE_PATH

        kwargs: Dict[str, Any] = {
            "urls": magnet_url,
            "save_path": target_path,
            "category": category,
            "is_paused": is_paused,
            "tags": ",".join(tags) if tags else None,
        }
        if skip_checking:
            kwargs["is_skip_checking"] = True
        if auto_tmm is not None:
            kwargs["use_auto_torrent_management"] = auto_tmm

        result = client.torrents_add(**kwargs)
        return str(result)

    def add_torrent_file(
        self,
        torrent_file_bytes: bytes,
        save_path: Optional[str] = None,
        category: Optional[str] = None,
        is_paused: bool = False,
        tags: Optional[List[str]] = None,
        skip_checking: bool = False,
        auto_tmm: Optional[bool] = None,
    ) -> str:
        """Adds a torrent from a .torrent file bytes to qBittorrent."""
        client = self.get_client()
        target_path = save_path or settings.DEFAULT_SAVE_PATH

        kwargs: Dict[str, Any] = {
            "torrent_files": torrent_file_bytes,
            "save_path": target_path,
            "category": category,
            "is_paused": is_paused,
            "tags": ",".join(tags) if tags else None,
        }
        if skip_checking:
            kwargs["is_skip_checking"] = True
        if auto_tmm is not None:
            kwargs["use_auto_torrent_management"] = auto_tmm

        result = client.torrents_add(**kwargs)
        return str(result)

    def list_torrents(
        self,
        status_filter: Optional[str] = None,
        category: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves list of torrents from qBittorrent."""
        client = self.get_client()
        torrents = client.torrents_info(
            status_filter=status_filter,
            category=category,
            tag=tag,
        )

        items = []
        for t in torrents:
            items.append(
                {
                    "hash": t.hash,
                    "name": t.name,
                    "state": t.state,
                    "progress": round(t.progress * 100, 2),
                    "total_size": t.total_size,
                    "downloaded": t.downloaded,
                    "uploaded": t.uploaded,
                    "download_speed": t.dlspeed,
                    "upload_speed": t.upspeed,
                    "eta": t.eta,
                    "save_path": t.save_path,
                }
            )
        return items

    def get_torrent(self, torrent_hash: str) -> Optional[Dict[str, Any]]:
        """Gets detailed info for a single torrent by hash."""
        client = self.get_client()
        results = client.torrents_info(torrent_hashes=torrent_hash)
        if not results:
            return None
        t = results[0]
        return {
            "hash": t.hash,
            "name": t.name,
            "state": t.state,
            "progress": round(t.progress * 100, 2),
            "total_size": t.total_size,
            "downloaded": t.downloaded,
            "uploaded": t.uploaded,
            "download_speed": t.dlspeed,
            "upload_speed": t.upspeed,
            "eta": t.eta,
            "save_path": t.save_path,
        }

    def pause_torrent(self, torrent_hash: str) -> None:
        client = self.get_client()
        client.torrents_pause(torrent_hashes=torrent_hash)

    def resume_torrent(self, torrent_hash: str) -> None:
        client = self.get_client()
        client.torrents_resume(torrent_hashes=torrent_hash)

    def delete_torrent(self, torrent_hash: str, delete_files: bool = False) -> None:
        client = self.get_client()
        client.torrents_delete(torrent_hashes=torrent_hash, delete_files=delete_files)

    def export_torrent_file(self, torrent_hash: str) -> bytes:
        """Exports the .torrent file data for a given torrent hash."""
        client = self.get_client()
        return client.torrents_export(torrent_hash=torrent_hash)

    def add_trackers(self, torrent_hash: str, trackers: List[str]) -> None:
        """Adds trackers to an existing torrent."""
        client = self.get_client()
        client.torrents_add_trackers(torrent_hash=torrent_hash, urls=trackers)


qbit_service = QBitService()

