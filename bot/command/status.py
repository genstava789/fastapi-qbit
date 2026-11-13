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


def build_status_keyboard(current_filter: str = "active") -> InlineKeyboardMarkup:
    """Builds full-width inline keyboard rows so buttons fill the entire message card width."""
    buttons = [
        [
            InlineKeyboardButton("🔄 Segarkan Status", callback_data=f"status_refresh:{current_filter}"),
        ],
        [
            InlineKeyboardButton(
                "📥 Unduhan Aktif" + (" ✓" if current_filter == "dl" else ""),
                callback_data="status_filter:dl",
            ),
        ],
        [
            InlineKeyboardButton(
                "📤 Seeding Aktif" + (" ✓" if current_filter == "up" else ""),
                callback_data="status_filter:up",
            ),
        ],
        [
            InlineKeyboardButton(
                "📋 Semua Task Torrent" + (" ✓" if current_filter == "all" else ""),
                callback_data="status_filter:all",
            ),
        ],
    ]
    if current_filter != "active":
        buttons.append([
            InlineKeyboardButton("⚡ Kembali ke Tampilan Utama", callback_data="status_filter:active")
        ])
    return InlineKeyboardMarkup(buttons)


def format_status_message(
    filter_type: str = "active",
    user_display_name: str = "Kang Mirror",
) -> Tuple[str, InlineKeyboardMarkup]:
    """Generates formatted status message in task card style with full-width keyboard."""
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
            [InlineKeyboardButton("🔄 Coba Lagi", callback_data="status_refresh:active")]
        ])
        return text, keyboard

    try:
        torrents = qbit_service.list_torrents()
    except Exception as e:
        logger.error(f"Error fetching torrents: {e}")
        torrents = []

    transfer = qbit_service.get_transfer_info()
    total_dl_data = transfer.get("dl_info_data", sum(t.get("downloaded", 0) for t in torrents))
    total_up_data = transfer.get("up_info_data", sum(t.get("uploaded", 0) for t in torrents))

    categories = categorize_torrents(torrents)
    downloading = categories["downloading"]
    uploading = categories["uploading"]
    stalled_dl = categories["stalled_dl"]

    # Filter selection
    if filter_type == "dl":
        tasks_to_render = downloading + stalled_dl
    elif filter_type == "up":
        tasks_to_render = uploading
    elif filter_type == "all":
        tasks_to_render = torrents
    else:
        # Default "active": active downloading first, then active uploading, then stalled
        tasks_to_render = downloading + uploading
        if not tasks_to_render and stalled_dl:
            tasks_to_render = stalled_dl

    cards = []
    # Limit max 8 tasks per message to prevent Telegram 4096-character limit overflow
    for t in tasks_to_render[:8]:
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
    keyboard = build_status_keyboard(filter_type)
    return full_text, keyboard


@Client.on_message(filters.command(["status"]))
async def status_command_handler(client: Client, message: Message):
    """Handles the /status command."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await message.reply_text(
            "⛔ Akses ditolak. Anda tidak memiliki izin untuk menggunakan bot ini."
        )
        return

    user_name = message.from_user.first_name if message.from_user else "Kang Mirror"
    text, keyboard = format_status_message(filter_type="active", user_display_name=user_name)
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


@Client.on_callback_query(filters.regex(r"^status_refresh:?(.*)"))
async def status_refresh_callback_handler(client: Client, callback_query: CallbackQuery):
    """Handles full-width refresh button click."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    filter_type = "active"
    if callback_query.data and ":" in callback_query.data:
        filter_type = callback_query.data.split(":", 1)[1] or "active"

    user_name = callback_query.from_user.first_name if callback_query.from_user else "Kang Mirror"
    text, keyboard = format_status_message(filter_type=filter_type, user_display_name=user_name)
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


@Client.on_callback_query(filters.regex(r"^status_filter:(.*)"))
async def status_filter_callback_handler(client: Client, callback_query: CallbackQuery):
    """Handles full-width filter button toggle."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    filter_type = callback_query.data.split(":", 1)[1] if callback_query.data else "active"
    user_name = callback_query.from_user.first_name if callback_query.from_user else "Kang Mirror"
    text, keyboard = format_status_message(filter_type=filter_type, user_display_name=user_name)
    try:
        await callback_query.edit_message_text(
            text, reply_markup=keyboard, disable_web_page_preview=True
        )
        await callback_query.answer()
    except MessageNotModified:
        await callback_query.answer()
    except Exception as e:
        logger.warning(f"Error changing filter: {e}")
        await callback_query.answer()
