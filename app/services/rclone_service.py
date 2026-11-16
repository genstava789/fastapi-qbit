import configparser
import logging
import os
import re
import shutil
import threading
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from app.core.config import settings
from app.schemas.rclone import RcloneConfigResponse, RcloneRemoteItem

logger = logging.getLogger(__name__)


def normalize_rclone_url(url: str) -> str:
    """Normalizes GitHub and Gist URLs to their raw plaintext counterparts."""
    clean_url = url.strip()
    parsed = urlparse(clean_url)
    netloc = parsed.netloc.lower()
    path = parsed.path

    # GitHub blob to raw: github.com/{user}/{repo}/blob/{branch}/{file_path}
    if "github.com" in netloc and "/blob/" in path:
        parts = path.strip("/").split("/")
        if len(parts) >= 4 and parts[2] == "blob":
            user = parts[0]
            repo = parts[1]
            branch = parts[3]
            subpath = "/".join(parts[4:])
            return f"https://raw.githubusercontent.com/{user}/{repo}/{branch}/{subpath}"

    # GitHub Gist to raw: gist.github.com/{user}/{gist_id}
    if "gist.github.com" in netloc:
        parts = path.strip("/").split("/")
        if len(parts) >= 2 and "raw" not in parts:
            user = parts[0]
            gist_id = parts[1]
            return f"https://gist.githubusercontent.com/{user}/{gist_id}/raw"

    return clean_url


def parse_rclone_remotes(content: str) -> Tuple[List[str], List[RcloneRemoteItem]]:
    """Parses remotes and their types from rclone.conf INI-style content."""
    remotes: List[str] = []
    remotes_detail: List[RcloneRemoteItem] = []

    # First attempt: configparser
    try:
        parser = configparser.ConfigParser(interpolation=None, strict=False)
        parser.read_string(content)
        for section in parser.sections():
            remote_type = parser.get(section, "type", fallback=None)
            remotes.append(section)
            remotes_detail.append(RcloneRemoteItem(name=section, type=remote_type))
        if remotes:
            return remotes, remotes_detail
    except Exception as exc:
        logger.debug(f"ConfigParser fallback due to: {exc}")

    # Fallback: regex parsing
    current_remote: Optional[str] = None
    current_type: Optional[str] = None

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue

        section_match = re.match(r"^\[([^\]]+)\]$", line)
        if section_match:
            if current_remote:
                remotes.append(current_remote)
                remotes_detail.append(RcloneRemoteItem(name=current_remote, type=current_type))
            current_remote = section_match.group(1).strip()
            current_type = None
            continue

        if current_remote and not current_type:
            type_match = re.match(r"^type\s*=\s*(.+)$", line, re.IGNORECASE)
            if type_match:
                current_type = type_match.group(1).strip()

    if current_remote:
        remotes.append(current_remote)
        remotes_detail.append(RcloneRemoteItem(name=current_remote, type=current_type))

    return remotes, remotes_detail


def validate_rclone_content(content: str) -> None:
    """Validates that content looks like an rclone configuration."""
    if not content or not content.strip():
        raise ValueError("Isi konfigurasi rclone kosong.")

    lower = content.lower()
    if "<!doctype html" in lower or "<html" in lower:
        raise ValueError("URL menghasilkan halaman HTML, bukan file teks mentah rclone.conf.")

    # Check for at least one remote section or key=value pair
    if not re.search(r"\[.+\]", content) and not re.search(r"^\s*[a-zA-Z0-9_-]+\s*=", content, re.MULTILINE):
        raise ValueError("Format file tidak valid untuk rclone.conf (tidak ditemukan section [remote]).")


class RcloneService:
    """Service to handle rclone configuration storage, synchronization, and inspection."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def get_config_path(self) -> str:
        """Returns the primary target file path for rclone.conf."""
        path = os.getenv("RCLONE_CONFIG_FILE", getattr(settings, "RCLONE_CONFIG_FILE", "rclone.conf"))
        if not os.path.isabs(path):
            path = os.path.abspath(path)
        return path

    def _sync_to_system_locations(self, content: str) -> None:
        """Attempts to sync rclone.conf to standard user/system paths if accessible."""
        candidate_dirs = [
            os.path.expanduser("~/.config/rclone"),
            "/home/boxd/.config/rclone",
        ]
        for cdir in candidate_dirs:
            try:
                os.makedirs(cdir, exist_ok=True)
                target = os.path.join(cdir, "rclone.conf")
                with open(target, "w", encoding="utf-8") as f:
                    f.write(content)
                if hasattr(os, "chmod"):
                    os.chmod(target, 0o600)
            except Exception as e:
                logger.debug(f"Could not sync rclone config to {cdir}: {e}")

    def _save_content(self, content: str) -> RcloneConfigResponse:
        """Saves content to disk, validates, syncs, and returns response."""
        validate_rclone_content(content)
        path = self.get_config_path()
        parent_dir = os.path.dirname(path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        with self._lock:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            if hasattr(os, "chmod"):
                try:
                    os.chmod(path, 0o600)
                except Exception:
                    pass

            self._sync_to_system_locations(content)

        return self.get_config_status(message="Konfigurasi rclone berhasil disimpan.")

    def get_config_status(self, message: Optional[str] = None) -> RcloneConfigResponse:
        """Returns the current status of rclone.conf."""
        path = self.get_config_path()
        with self._lock:
            if not os.path.isfile(path) or os.path.getsize(path) == 0:
                # Check fallback candidate
                fallback = os.path.expanduser("~/.config/rclone/rclone.conf")
                if os.path.isfile(fallback) and os.path.getsize(fallback) > 0:
                    path = fallback
                else:
                    return RcloneConfigResponse(
                        configured=False,
                        file_path=path,
                        file_size=0,
                        modified_at=None,
                        remotes=[],
                        remotes_detail=[],
                        message=message,
                    )

            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                stat = os.stat(path)
                remotes, remotes_detail = parse_rclone_remotes(content)
                return RcloneConfigResponse(
                    configured=bool(remotes or len(content.strip()) > 0),
                    file_path=path,
                    file_size=stat.st_size,
                    modified_at=stat.st_mtime,
                    remotes=remotes,
                    remotes_detail=remotes_detail,
                    message=message,
                )
            except Exception as exc:
                logger.warning(f"Error reading rclone config '{path}': {exc}")
                return RcloneConfigResponse(
                    configured=False,
                    file_path=path,
                    file_size=0,
                    modified_at=None,
                    remotes=[],
                    remotes_detail=[],
                    message=f"Gagal membaca konfigurasi: {exc}",
                )

    async def save_from_url(self, raw_url: str) -> RcloneConfigResponse:
        """Downloads rclone.conf from a raw GitHub/Gist URL and saves it."""
        normalized_url = normalize_rclone_url(raw_url)
        logger.info(f"Fetching rclone config from URL: {normalized_url}")

        async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
            try:
                resp = await client.get(normalized_url)
            except Exception as exc:
                raise ValueError(f"Gagal mengunduh file dari URL: {exc}") from exc

            if resp.status_code != 200:
                raise ValueError(f"Gagal mengambil konfigurasi: HTTP {resp.status_code}")

            content = resp.text
            return self._save_content(content)

    def save_from_file_content(self, content: str) -> RcloneConfigResponse:
        """Saves uploaded rclone.conf content directly."""
        return self._save_content(content)

    def delete_config(self) -> RcloneConfigResponse:
        """Deletes or empties rclone.conf."""
        path = self.get_config_path()
        with self._lock:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception as exc:
                    logger.warning(f"Error removing {path}: {exc}")
                    with open(path, "w", encoding="utf-8") as f:
                        f.write("")

            # Also clear system fallback
            fallback = os.path.expanduser("~/.config/rclone/rclone.conf")
            if os.path.exists(fallback):
                try:
                    os.remove(fallback)
                except Exception:
                    pass

        return RcloneConfigResponse(
            configured=False,
            file_path=path,
            file_size=0,
            modified_at=None,
            remotes=[],
            remotes_detail=[],
            message="Konfigurasi rclone berhasil dihapus.",
        )


rclone_service = RcloneService()
