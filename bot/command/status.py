from datetime import datetime
import logging
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
    escape_html,
    format_bytes,
    format_eta,
    format_speed,
    get_disk_space_info,
    get_torrent_badge,
    is_user_authorized,
    make_progress_bar,
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


def build_status_keyboard(current_filter: str = "active") -> InlineKeyboardMarkup:
    """Builds inline action keyboard for status view."""
    buttons = [
        [
            InlineKeyboardButton("🔄 Segarkan Status", callback_data=f"status_refresh:{current_filter}"),
        ],
        [
            InlineKeyboardButton(
                "📥 Download" + (" ✓" if current_filter == "dl" else ""),
                callback_data="status_filter:dl",
            ),
            InlineKeyboardButton(
                "📤 Upload" + (" ✓" if current_filter == "up" else ""),
                callback_data="status_filter:up",
            ),
            InlineKeyboardButton(
                "📋 Semua" + (" ✓" if current_filter == "all" else ""),
                callback_data="status_filter:all",
            ),
        ],
    ]
    if current_filter != "active":
        buttons.append([
            InlineKeyboardButton("⚡ Tampilan Ringkas (Aktif)", callback_data="status_filter:active")
        ])
    return InlineKeyboardMarkup(buttons)


def format_status_message(filter_type: str = "active") -> Tuple[str, InlineKeyboardMarkup]:
    """Generates the formatted status message and inline keyboard."""
    connected, version = qbit_service.check_connection()
    if not connected:
        text = (
            "⚠️ <b>qBittorrent Status</b>\n\n"
            "🔴 <b>Status: Offline / Tidak Terhubung</b>\n"
            "Gagal menghubungi qBittorrent daemon.\n"
            "Pastikan service qBittorrent sedang aktif pada server."
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
    global_dl_speed = transfer.get("dl_info_speed", sum(t.get("download_speed", 0) for t in torrents))
    global_up_speed = transfer.get("up_info_speed", sum(t.get("upload_speed", 0) for t in torrents))
    total_dl_data = transfer.get("dl_info_data", sum(t.get("downloaded", 0) for t in torrents))
    total_up_data = transfer.get("up_info_data", sum(t.get("uploaded", 0) for t in torrents))

    categories = categorize_torrents(torrents)
    downloading = categories["downloading"]
    uploading = categories["uploading"]
    stalled_dl = categories["stalled_dl"]
    completed = categories["completed"]
    paused = categories["paused"]
    other = categories["other"]

    now_str = datetime.now().strftime("%H:%M:%S")
    disk_info = get_disk_space_info()

    lines: List[str] = []
    lines.append("📊 <b>qBittorrent Status</b>")
    lines.append(f"🟢 <b>Server:</b> Online (<code>{version or 'qBittorrent'}</code>)")
    lines.append(f"⚡ <b>Kecepatan:</b> ⬇️ <b>{format_speed(global_dl_speed)}</b> | ⬆️ <b>{format_speed(global_up_speed)}</b>")
    lines.append(f"📦 <b>Transfer:</b> ⬇️ {format_bytes(total_dl_data)} | ⬆️ {format_bytes(total_up_data)}")
    lines.append(f"💾 <b>Storage:</b> {disk_info}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━")

    # Filter specific rendering
    if filter_type == "dl":
        lines.append(f"📥 <b>Daftar Unduhan ({len(downloading) + len(stalled_dl)} item)</b>\n")
        items_to_show = downloading + stalled_dl
        if not items_to_show:
            lines.append("<i>Tidak ada torrent yang sedang diunduh saat ini.</i>")
        else:
            for idx, t in enumerate(items_to_show[:10], 1):
                name = escape_html(t.get("name", "Unknown"))
                progress = float(t.get("progress", 0))
                total_size = int(t.get("total_size", 0))
                downloaded = int(t.get("downloaded", 0))
                dl_speed = int(t.get("download_speed", 0))
                eta_val = t.get("eta", 0)
                seeds = max(int(t.get("num_seeds", 0) or 0), int(t.get("num_complete", 0) or 0))
                leechs = max(int(t.get("num_leechs", 0) or 0), int(t.get("num_incomplete", 0) or 0))

                lines.append(f"{idx}. <b>{name}</b>")
                lines.append(f"   ├ {make_progress_bar(progress)}")
                lines.append(f"   ├ Ukuran: {format_bytes(downloaded)} / {format_bytes(total_size)}")
                lines.append(f"   ├ Speed: ⬇️ <b>{format_speed(dl_speed)}</b> • ETA: <b>{format_eta(eta_val)}</b>")
                lines.append(f"   └ Peers: 👥 <b>{seeds}</b> seeds / <b>{leechs}</b> leechers\n")

            if len(items_to_show) > 10:
                lines.append(f"<i>...dan {len(items_to_show) - 10} unduhan lainnya.</i>")

    elif filter_type == "up":
        lines.append(f"📤 <b>Daftar Seeding / Upload ({len(uploading)} aktif)</b>\n")
        if not uploading:
            lines.append("<i>Tidak ada torrent yang sedang aktif mengunggah data saat ini.</i>")
        else:
            for idx, t in enumerate(uploading[:10], 1):
                name = escape_html(t.get("name", "Unknown"))
                total_size = int(t.get("total_size", 0))
                uploaded = int(t.get("uploaded", 0))
                up_speed = int(t.get("upload_speed", 0))
                ratio = t.get("ratio")
                ratio_str = f"{ratio:.2f}" if ratio is not None else "0.00"
                seeds = max(int(t.get("num_seeds", 0) or 0), int(t.get("num_complete", 0) or 0))
                leechs = max(int(t.get("num_leechs", 0) or 0), int(t.get("num_incomplete", 0) or 0))

                lines.append(f"{idx}. <b>{name}</b>")
                lines.append(f"   ├ Ukuran: {format_bytes(total_size)} • Rasio: <b>{ratio_str}</b>")
                lines.append(f"   ├ Speed: ⬆️ <b>{format_speed(up_speed)}</b> • Uploaded: {format_bytes(uploaded)}")
                lines.append(f"   └ Peers: 👥 <b>{seeds}</b> seeds / <b>{leechs}</b> leechers\n")

            if len(uploading) > 10:
                lines.append(f"<i>...dan {len(uploading) - 10} torrent lainnya.</i>")

    elif filter_type == "all":
        lines.append(f"📋 <b>Semua Torrent ({len(torrents)} item)</b>\n")
        if not torrents:
            lines.append("<i>Belum ada torrent di dalam daftar.</i>")
        else:
            for idx, t in enumerate(torrents[:15], 1):
                name = escape_html(t.get("name", "Unknown"))
                progress = float(t.get("progress", 0))
                state = str(t.get("state", ""))
                badge_emoji, badge_label = get_torrent_badge(state, t.get("upload_speed", 0))
                total_size = int(t.get("total_size", 0))
                dl_speed = int(t.get("download_speed", 0))
                up_speed = int(t.get("upload_speed", 0))

                speed_str = ""
                if dl_speed > 0:
                    speed_str += f" ⬇️ {format_speed(dl_speed)}"
                if up_speed > 0:
                    speed_str += f" ⬆️ {format_speed(up_speed)}"

                lines.append(f"{idx}. {badge_emoji} <b>{name}</b>")
                lines.append(f"   └ {progress:.1f}% ({format_bytes(total_size)}) [{badge_label}]{speed_str}")

            if len(torrents) > 15:
                lines.append(f"\n<i>...dan {len(torrents) - 15} torrent lainnya.</i>")

    else:
        # Default: Active downloads & uploads view
        has_active = False

        if downloading:
            has_active = True
            lines.append(f"📥 <b>Sedang Mengunduh ({len(downloading)} aktif)</b>:")
            for idx, t in enumerate(downloading[:5], 1):
                name = escape_html(t.get("name", "Unknown"))
                progress = float(t.get("progress", 0))
                total_size = int(t.get("total_size", 0))
                downloaded = int(t.get("downloaded", 0))
                dl_speed = int(t.get("download_speed", 0))
                up_speed = int(t.get("upload_speed", 0))
                eta_val = t.get("eta", 0)
                seeds = max(int(t.get("num_seeds", 0) or 0), int(t.get("num_complete", 0) or 0))
                leechs = max(int(t.get("num_leechs", 0) or 0), int(t.get("num_incomplete", 0) or 0))

                speed_text = f"⬇️ <b>{format_speed(dl_speed)}</b>"
                if up_speed > 0:
                    speed_text += f" | ⬆️ {format_speed(up_speed)}"

                lines.append(f"\n{idx}. <b>{name}</b>")
                lines.append(f"   ├ Progress: <code>{make_progress_bar(progress)}</code>")
                lines.append(f"   ├ Ukuran: <b>{format_bytes(downloaded)}</b> / {format_bytes(total_size)}")
                lines.append(f"   ├ Kecepatan: {speed_text}")
                lines.append(f"   ├ ETA: ⏱️ <b>{format_eta(eta_val)}</b>")
                lines.append(f"   └ Peers: 👥 <b>{seeds}</b> seeds / <b>{leechs}</b> leechers")

            if len(downloading) > 5:
                lines.append(f"   <i>...dan {len(downloading) - 5} unduhan aktif lainnya.</i>")
            lines.append("")

        if uploading:
            has_active = True
            lines.append(f"📤 <b>Sedang Seeding / Mengunggah ({len(uploading)} aktif)</b>:")
            for idx, t in enumerate(uploading[:5], 1):
                name = escape_html(t.get("name", "Unknown"))
                total_size = int(t.get("total_size", 0))
                up_speed = int(t.get("upload_speed", 0))
                ratio = t.get("ratio")
                ratio_str = f"{ratio:.2f}" if ratio is not None else "0.00"
                seeds = max(int(t.get("num_seeds", 0) or 0), int(t.get("num_complete", 0) or 0))
                leechs = max(int(t.get("num_leechs", 0) or 0), int(t.get("num_incomplete", 0) or 0))

                lines.append(f"\n{idx}. <b>{name}</b>")
                lines.append(f"   ├ Ukuran: <b>{format_bytes(total_size)}</b> • Rasio: <b>{ratio_str}</b>")
                lines.append(f"   ├ Kecepatan: ⬆️ <b>{format_speed(up_speed)}</b>")
                lines.append(f"   └ Peers: 👥 <b>{seeds}</b> seeds / <b>{leechs}</b> leechers")

            if len(uploading) > 5:
                lines.append(f"   <i>...dan {len(uploading) - 5} torrent seeding lainnya.</i>")
            lines.append("")

        if not has_active:
            lines.append("ℹ️ <i>Tidak ada torrent yang sedang aktif mengunduh atau mengunggah saat ini.</i>\n")

        # Summary footer
        lines.append("━━━━━━━━━━━━━━━━━━━━━")
        lines.append("📌 <b>Ringkasan Torrent:</b>")
        lines.append(f"• Selesai (Completed): <b>{len(completed)}</b>")
        lines.append(f"• Dijeda (Paused): <b>{len(paused)}</b>")
        if stalled_dl:
            lines.append(f"• Tertunda (Stalled): <b>{len(stalled_dl)}</b>")
        lines.append(f"• Total Terdaftar: <b>{len(torrents)} torrents</b>")

    lines.append(f"\n<i>🕒 Terakhir diperbarui: {now_str}</i>")

    return "\n".join(lines), build_status_keyboard(filter_type)


@Client.on_message(filters.command(["status"]))
async def status_command_handler(client: Client, message: Message):
    """Handles the /status command."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await message.reply_text(
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan bot ini.",
        )
        return

    text, keyboard = format_status_message(filter_type="active")
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


@Client.on_callback_query(filters.regex(r"^status_refresh:?(.*)"))
async def status_refresh_callback_handler(client: Client, callback_query: CallbackQuery):
    """Handles the refresh button click."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    filter_type = "active"
    if callback_query.data and ":" in callback_query.data:
        filter_type = callback_query.data.split(":", 1)[1] or "active"

    text, keyboard = format_status_message(filter_type=filter_type)
    try:
        await callback_query.edit_message_text(
            text, reply_markup=keyboard, disable_web_page_preview=True
        )
        await callback_query.answer("Status berhasil diperbarui! ⚡", show_alert=False)
    except MessageNotModified:
        await callback_query.answer("Data sudah paling baru! 👍", show_alert=False)
    except Exception as e:
        logger.warning(f"Error updating status message: {e}")
        await callback_query.answer("Selesai memperbarui.", show_alert=False)


@Client.on_callback_query(filters.regex(r"^status_filter:(.*)"))
async def status_filter_callback_handler(client: Client, callback_query: CallbackQuery):
    """Handles filter toggle buttons."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    filter_type = callback_query.data.split(":", 1)[1] if callback_query.data else "active"
    text, keyboard = format_status_message(filter_type=filter_type)
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
