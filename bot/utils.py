import html
import os
import shutil
from typing import Set
from app.core.config import settings


def format_bytes(bytes_num: int | float, decimals: int = 2) -> str:
    """Formats bytes into human readable format (B, KB, MB, GB, TB)."""
    if bytes_num is None or bytes_num <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    k = 1024.0
    i = 0
    val = float(bytes_num)
    while val >= k and i < len(units) - 1:
        val /= k
        i += 1
    return f"{val:.{decimals}f} {units[i]}"


def format_speed(speed: int | float) -> str:
    """Formats byte rate into transfer speed (e.g. 1.25 MB/s)."""
    return f"{format_bytes(speed)}/s"


def format_eta(seconds: int | float) -> str:
    """Formats seconds into readable ETA (e.g. 1h 25m, 45s)."""
    if seconds is None or seconds <= 0 or seconds >= 8640000:
        return "∞"
    seconds = int(seconds)
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours}h {minutes}m"
    if minutes > 0:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def make_progress_bar(percent: float, length: int = 10) -> str:
    """Generates a text-based progress bar.

    Example: [██████░░░░] 60.0%
    """
    pct = max(0.0, min(100.0, float(percent or 0.0)))
    filled = int(round((pct / 100.0) * length))
    filled = max(0, min(length, filled))
    bar = "█" * filled + "░" * (length - filled)
    return f"[{bar}] {pct:.1f}%"


def get_torrent_badge(state: str, upload_speed: int = 0) -> tuple[str, str]:
    """Returns an emoji and friendly label for the torrent state."""
    state_str = (state or "").lower()
    if "paused" in state_str:
        return "⏸️", "Paused"
    if state_str == "stalledup":
        return ("📤", "Seeding") if upload_speed > 0 else ("✅", "Completed")
    if state_str == "stalleddl":
        return "⏳", "Stalled"
    if state_str in ("uploading", "forcedup") or "up" in state_str:
        return "📤", "Seeding"
    if state_str in ("downloading", "forceddl") or "dl" in state_str:
        return "📥", "Downloading"
    if "checking" in state_str:
        return "🔍", "Checking"
    if "queued" in state_str:
        return "🕒", "Queued"
    if "error" in state_str or "missing" in state_str:
        return "❌", "Error"
    return "🔹", state or "Unknown"


def escape_html(text: str) -> str:
    """Safely escapes HTML characters for Telegram messages."""
    return html.escape(str(text or ""))


def get_authorized_user_ids() -> Set[int]:
    """Parses authorized Telegram user IDs from settings."""
    raw = (
        settings.TELEGRAM_AUTHORIZED_USERS
        or os.getenv("TELEGRAM_AUTHORIZED_USERS")
        or str(getattr(settings, "OWNER_ID", "") or "")
        or os.getenv("OWNER_ID", "")
    )
    if not raw:
        return set()
    result = set()
    for item in str(raw).split(","):
        cleaned = item.strip()
        if cleaned.isdigit():
            result.add(int(cleaned))
    return result


def is_user_authorized(user_id: int) -> bool:
    """Checks whether a user is allowed to interact with the bot."""
    authorized_ids = get_authorized_user_ids()
    if not authorized_ids:
        # If no authorized list is configured, bot is accessible
        return True
    return user_id in authorized_ids


def get_disk_space_info() -> str:
    """Checks free disk storage on the configured download directory."""
    target_path = settings.DEFAULT_SAVE_PATH or "."
    try:
        # Check if directory exists, otherwise find parent
        probe_path = target_path
        while probe_path and not os.path.exists(probe_path):
            parent = os.path.dirname(probe_path)
            if parent == probe_path:
                probe_path = "."
                break
            probe_path = parent

        usage = shutil.disk_usage(probe_path or ".")
        free_formatted = format_bytes(usage.free)
        total_formatted = format_bytes(usage.total)
        return f"{free_formatted} free / {total_formatted}"
    except Exception:
        return "Disk info unavailable"
