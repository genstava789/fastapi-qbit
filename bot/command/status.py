import logging
import time
from typing import Any, Dict, List, Tuple
from pyrogram import Client, filters
from pyrogram.errors import MessageNotModified
from pyrogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from app.services.qbit_service import qbit_service
from bot.utils import (
    format_bytes_compact,
    format_duration_id,
    get_free_disk_space_compact,
    get_host_uptime_id,
    get_kaomoji_status,
    is_user_authorized,
    make_square_progress_bar,
)

logger = logging.getLogger(__name__)

PAGE_SIZE = 5


def categorize_torrents(
    torrents: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """Categorizes torrents into downloading, uploading, stalled, paused, completed, and others."""
    result: Dict[str, List[Dict[str, Any]]] = {
        "downloading": [],
        "uploading": [],
        "stalled_dl": [],
        "completed": [],
        "paused": [],
        "other": [],
    }

    for t in torrents:
        state = str(t.get("state", "")).lower()
        progress = float(t.get("progress", 0) or 0)
        dl_speed = int(t.get("download_speed", 0) or 0)
        up_speed = int(t.get("upload_speed", 0) or 0)

        if "paused" in state:
            result["paused"].append(t)
        elif dl_speed > 0 or state in ("downloading", "forceddl"):
            result["downloading"].append(t)
        elif up_speed > 0 or state in ("uploading", "forcedup"):
            result["uploading"].append(t)
        elif state == "stalleddl":
            result["stalled_dl"].append(t)
        elif progress >= 100 or state == "stalledup" or "up" in state:
            result["completed"].append(t)
        else:
            result["other"].append(t)

    return result


def sort_torrents_like_frontend(torrents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sorts all torrents similar to frontend priorities:

    1. Actively downloading / forcedDL
    2. Stalled downloads
    3. Actively uploading / seeding
    4. Paused
    5. Completed / Idle seeding
    """
    def sort_key(t: Dict[str, Any]):
        state = str(t.get("state", "")).lower()
        dl_speed = int(t.get("download_speed", 0) or 0)
        up_speed = int(t.get("upload_speed", 0) or 0)
        progress = float(t.get("progress", 0) or 0)
        added_on = int(t.get("added_on", 0) or 0)

        # Tier 0: Actively downloading
        if dl_speed > 0 or state in ("downloading", "forceddl"):
            tier = 0
        # Tier 1: Stalled download
        elif state == "stalleddl":
            tier = 1
        # Tier 2: Actively uploading / seeding
        elif up_speed > 0 or state in ("uploading", "forcedup"):
            tier = 2
        # Tier 3: Paused
        elif "paused" in state:
            tier = 3
        # Tier 4: Completed / Idle seeding
        elif progress >= 100 or state == "stalledup" or "up" in state:
            tier = 4
        else:
            tier = 5
        return (tier, -added_on)

    return sorted(torrents, key=sort_key)


def render_task_card(
    t: Dict[str, Any],
    version: str = "5.3.0",
    default_user: str = "Kang Mirror",
) -> str:
    """Renders a single torrent task card in mirror leech format."""
    name = t.get("name", "Unknown")
    progress = float(t.get("progress", 0) or 0)
    dl_speed = int(t.get("download_speed", 0) or 0)
    up_speed = int(t.get("upload_speed", 0) or 0)
    downloaded = int(t.get("downloaded", 0) or 0)
    total_size = int(t.get("total_size", 0) or 0)
    state = str(t.get("state", ""))
    now_ts = int(time.time())
    added_on = int(t.get("added_on") or now_ts)
    elapsed_sec = max(0, now_ts - added_on)

    # Task ID: deterministic 3-digit format (e.g. Kqng-017, Kqng-139, Kqng-502)
    h = str(t.get("hash", "")).strip()
    if h:
        try:
            num = int(h[:6], 16) % 1000
            task_id = f"Kqng-{num:03d}"
        except ValueError:
            task_id = f"Kqng-{h[:4]}"
    else:
        task_id = "Kqng-001"

    # Status kaomoji
    kaomoji = get_kaomoji_status(state, dl_speed=dl_speed, progress=progress)

    # Clean qBittorrent version
    clean_version = version.lstrip("v") if version else "5.3.0"

    # Elapsed and ETA
    elapsed_str = format_duration_id(elapsed_sec)
    eta_val = t.get("eta", 0)
    if eta_val is not None and 0 < eta_val < 8640000:
        eta_str = format_duration_id(eta_val)
    elif eta_val is not None and eta_val >= 8640000:
        eta_str = "100h"
    elif progress >= 100:
        eta_str = "0d"
    else:
        eta_str = "100h"

    # Active speed
    active_speed = dl_speed if dl_speed > 0 else up_speed
    speed_str = f"{format_bytes_compact(active_speed)}/s"

    # Seeds and Leechers
    seeds = max(int(t.get("num_seeds", 0) or 0), int(t.get("num_complete", 0) or 0))
    leechs = max(int(t.get("num_leechs", 0) or 0), int(t.get("num_incomplete", 0) or 0))

    # User
    task_user = t.get("category") or t.get("tags") or default_user

    lines = [
        name,
        make_square_progress_bar(progress),
        f"├ ID: {task_id}",
        f"├ Status: * {kaomoji}",
        f"├ Alat: qBittorrent {clean_version}",
        f"├ Waktu: {elapsed_str} | {eta_str}",
        f"├ Proses: {format_bytes_compact(downloaded)} / {format_bytes_compact(total_size)}",
        f"├ Kecepatan: {speed_str}",
    ]

    if seeds > 0 or leechs > 0:
        lines.append(f"├ Seeders: {seeds}")
        lines.append(f"├ Leechers: {leechs}")

    lines.append(f"├ User: {task_user}")
    lines.append("└ * | *")

    return "\n".join(lines)


def build_status_keyboard(page: int, total_pages: int, total_items: int) -> InlineKeyboardMarkup:
    """Builds inline keyboard with refresh button and full-width pagination controls."""
    buttons = [
        [
            InlineKeyboardButton("🔄 Segarkan Status", callback_data=f"status_refresh:{page}")
        ]
    ]

    if total_pages > 1:
        nav_buttons = []
        if page > 1:
            nav_buttons.append(
                InlineKeyboardButton("◀️ Sebelumnya", callback_data=f"status_page:{page - 1}")
            )
        if page < total_pages:
            nav_buttons.append(
                InlineKeyboardButton("Selanjutnya ▶️", callback_data=f"status_page:{page + 1}")
            )

        if nav_buttons:
            buttons.append(nav_buttons)

        buttons.append([
            InlineKeyboardButton(
                f"📄 Halaman {page}/{total_pages} ({total_items} Task)",
                callback_data=f"status_page_info:{page}:{total_pages}:{total_items}",
            )
        ])

    return InlineKeyboardMarkup(buttons)


def format_status_message(
    page: int = 1,
    user_display_name: str = "Kang Mirror",
    page_size: int = PAGE_SIZE,
) -> Tuple[str, InlineKeyboardMarkup]:
    """Generates paginated status message containing all torrent statuses (download/upload/completed)."""
    connected, version = qbit_service.check_connection()
    clean_version = (version or "5.3.0").lstrip("v")

    if not connected:
        text = (
            "qBittorrent Status\n"
            "┌┤□□□□□□□□□□│ 0%\n"
            "├ Status: * (ノ_<。)\n"
            "├ Keterangan: Gagal terhubung ke daemon qBittorrent\n"
            "└ * | *"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 Coba Lagi", callback_data="status_refresh:1")]
        ])
        return text, keyboard

    try:
        raw_torrents = qbit_service.list_torrents()
    except Exception as e:
        logger.error(f"Error fetching torrents: {e}")
        raw_torrents = []

    all_torrents = sort_torrents_like_frontend(raw_torrents)

    transfer = qbit_service.get_transfer_info()
    total_dl_data = transfer.get("dl_info_data", sum(t.get("downloaded", 0) for t in raw_torrents))
    total_up_data = transfer.get("up_info_data", sum(t.get("uploaded", 0) for t in raw_torrents))

    total_items = len(all_torrents)
    total_pages = max(1, (total_items + page_size - 1) // page_size)
    current_page = max(1, min(page, total_pages))

    start_idx = (current_page - 1) * page_size
    end_idx = start_idx + page_size
    page_tasks = all_torrents[start_idx:end_idx]

    cards = []
    for t in page_tasks:
        cards.append(render_task_card(t, version=clean_version, default_user=user_display_name))

    sisa_disk = get_free_disk_space_compact()
    aktif_uptime = get_host_uptime_id()
    masuk_data = format_bytes_compact(total_dl_data)
    keluar_data = format_bytes_compact(total_up_data)

    footer = (
        f"Sisa: {sisa_disk} | Aktif: {aktif_uptime}\n"
        f"Masuk: {masuk_data} | Keluar: {keluar_data}"
    )

    if not cards:
        body = "Tidak ada task aktif saat ini."
    else:
        body = "\n \n".join(cards)

    full_text = f"{body}\n \n{footer}"
    keyboard = build_status_keyboard(current_page, total_pages, total_items)
    return full_text, keyboard


@Client.on_message(filters.command(["status"]))
async def status_command_handler(client: Client, message: Message):
    """Handles the /status command, displaying all torrents with 5 items per page."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await message.reply_text(
            "⛔ Akses ditolak. Anda tidak memiliki izin untuk menggunakan bot ini."
        )
        return

    user_name = message.from_user.first_name if message.from_user else "Kang Mirror"
    text, keyboard = format_status_message(page=1, user_display_name=user_name)
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


@Client.on_callback_query(filters.regex(r"^status_refresh(?::(\d+))?"))
async def status_refresh_callback_handler(client: Client, callback_query: CallbackQuery):
    """Handles refresh button click for the current page."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    page = 1
    match = callback_query.matches[0]
    if match and match.group(1):
        try:
            page = int(match.group(1))
        except ValueError:
            page = 1

    user_name = callback_query.from_user.first_name if callback_query.from_user else "Kang Mirror"
    text, keyboard = format_status_message(page=page, user_display_name=user_name)
    try:
        await callback_query.edit_message_text(
            text, reply_markup=keyboard, disable_web_page_preview=True
        )
        await callback_query.answer("Status diperbarui! ⚡", show_alert=False)
    except MessageNotModified:
        await callback_query.answer("Data sudah paling baru! 👍", show_alert=False)
    except Exception as e:
        logger.warning(f"Error updating status message: {e}")
        await callback_query.answer("Selesai memperbarui.", show_alert=False)


@Client.on_callback_query(filters.regex(r"^status_page:(\d+)"))
async def status_page_callback_handler(client: Client, callback_query: CallbackQuery):
    """Handles pagination navigation buttons."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    match = callback_query.matches[0]
    page = int(match.group(1)) if match and match.group(1) else 1

    user_name = callback_query.from_user.first_name if callback_query.from_user else "Kang Mirror"
    text, keyboard = format_status_message(page=page, user_display_name=user_name)
    try:
        await callback_query.edit_message_text(
            text, reply_markup=keyboard, disable_web_page_preview=True
        )
        await callback_query.answer()
    except MessageNotModified:
        await callback_query.answer()
    except Exception as e:
        logger.warning(f"Error switching page: {e}")
        await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^status_page_info:(\d+):(\d+):(\d+)"))
async def status_page_info_callback_handler(client: Client, callback_query: CallbackQuery):
    """Shows an informational toast when tapping the page indicator."""
    match = callback_query.matches[0]
    page = match.group(1)
    total_pages = match.group(2)
    total_items = match.group(3)
    await callback_query.answer(
        f"Halaman {page} dari {total_pages} (Total: {total_items} tugas)",
        show_alert=False,
    )


@Client.on_callback_query(filters.regex(r"^status_noop"))
async def status_noop_callback_handler(client: Client, callback_query: CallbackQuery):
    """Fallback no-op for info buttons."""
    await callback_query.answer("Informasi Halaman", show_alert=False)
