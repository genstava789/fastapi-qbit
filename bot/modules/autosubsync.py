"""AutoSubSync Bot Module.

Provides interactive Telegram bot workflows for synchronizing subtitles (.srt/.ass)
with video files (.mp4/.mkv/etc.) using AutoSubSync engines (ffsubsync & autosubsync).
"""

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional
from pyrogram import Client, filters
from pyrogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from app.core.config import settings
from bot import LOGGER
from bot.utils import (
    escape_html,
    format_bytes,
    is_user_authorized,
    make_square_progress_bar,
    new_task,
    send_file,
    send_message,
)
from .autosubsync_engine import (
    AutoSubSyncEngine,
    SyncResult,
    auto_sub_sync_engine,
)

logger = LOGGER or logging.getLogger(__name__)

# User sessions: user_id -> dict
autosubsync_sessions: Dict[int, Dict[str, Any]] = {}
PAGE_SIZE = 8


def get_base_save_path() -> str:
    """Returns the validated base download directory."""
    raw = getattr(settings, "DEFAULT_SAVE_PATH", "/downloads") or "/downloads"
    path = os.path.realpath(raw)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        pass
    return path


def scan_autosubsync_items(
    directory: str,
    step: str = "pick_video",
    selected_video: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Scans and categorizes files and folders for AutoSubSync."""
    base_root = get_base_save_path()
    real_dir = os.path.realpath(directory)
    try:
        if os.path.commonpath([base_root, real_dir]) != base_root:
            real_dir = base_root
    except ValueError:
        real_dir = base_root

    folders: List[Dict[str, Any]] = []
    videos: List[Dict[str, Any]] = []
    subtitles: List[Dict[str, Any]] = []
    all_file_paths: List[str] = []

    if not os.path.exists(real_dir):
        return {
            "current_dir": real_dir,
            "items": [],
            "auto_pairs": [],
            "folders_count": 0,
            "videos_count": 0,
            "subtitles_count": 0,
        }

    try:
        with os.scandir(real_dir) as entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=True):
                        folders.append({
                            "name": entry.name,
                            "path": entry.path,
                            "is_dir": True,
                            "size": 0,
                            "formatted_size": "Folder",
                            "similarity": 0.0,
                        })
                    elif entry.is_file(follow_symlinks=True):
                        all_file_paths.append(entry.path)
                        size = entry.stat().st_size
                        item = {
                            "name": entry.name,
                            "path": entry.path,
                            "is_dir": False,
                            "size": size,
                            "formatted_size": format_bytes(size),
                            "similarity": 0.0,
                        }
                        if auto_sub_sync_engine.is_video(entry.name):
                            videos.append(item)
                        elif auto_sub_sync_engine.is_subtitle(entry.name):
                            subtitles.append(item)
                except Exception:
                    continue
    except Exception as exc:
        logger.warning(f"Error scanning directory '{real_dir}': {exc}")

    # Detect auto-pairs in this directory
    auto_pairs = auto_sub_sync_engine.find_matching_pairs(all_file_paths)

    # Sort folders alphabetically
    folders.sort(key=lambda x: x["name"].lower())

    if step == "pick_video":
        # Step 1: folders first, then video files
        videos.sort(key=lambda x: x["name"].lower())
        items = folders + videos
    else:
        # Step 2: subtitles sorted by similarity to selected video
        vid_name = selected_video["name"] if selected_video else ""
        for sub in subtitles:
            sim = auto_sub_sync_engine.calculate_similarity(vid_name, sub["name"])
            sub["similarity"] = sim

        # Sort: highest similarity first, then alphabetical
        subtitles.sort(key=lambda x: (-x["similarity"], x["name"].lower()))
        # Show subtitles first, then subfolders (in case subs are in a subfolder)
        items = subtitles + folders

    return {
        "current_dir": real_dir,
        "items": items,
        "auto_pairs": auto_pairs,
        "folders_count": len(folders),
        "videos_count": len(videos),
        "subtitles_count": len(subtitles),
    }


def build_autosubsync_menu_data(
    user_id: int,
    current_dir: Optional[str] = None,
    page: int = 1,
) -> tuple[str, Optional[InlineKeyboardMarkup]]:
    """Builds the text and inline keyboard markup for the AutoSubSync wizard."""
    base_root = get_base_save_path()
    session = autosubsync_sessions.get(user_id)

    if not session:
        if not current_dir:
            current_dir = base_root
        current_dir = os.path.realpath(current_dir)
        session = {
            "current_dir": current_dir,
            "step": "pick_video",
            "page": 1,
            "total_pages": 1,
            "video_item": None,
            "sub_item": None,
            "engine": "ffsubsync",
            "timestamp": time.time(),
            "items": [],
            "last_result": None,
        }
        autosubsync_sessions[user_id] = session

    step = session.get("step", "pick_video")
    if current_dir:
        session["current_dir"] = os.path.realpath(current_dir)
    active_dir = session.get("current_dir", base_root)

    # Ensure path stays within base_root
    try:
        if os.path.commonpath([base_root, active_dir]) != base_root:
            active_dir = base_root
            session["current_dir"] = base_root
    except ValueError:
        active_dir = base_root
        session["current_dir"] = base_root

    rel_path = os.path.relpath(active_dir, base_root)
    display_path = "/" if rel_path == "." else f"/{rel_path.replace(os.sep, '/')}"

    # -------------------------------------------------------------
    # STEP 3: CONFIRMATION MENU
    # -------------------------------------------------------------
    if step == "confirm":
        video = session.get("video_item")
        sub = session.get("sub_item")
        engine_name = session.get("engine", "ffsubsync")

        if not video or not sub:
            session["step"] = "pick_video"
            return build_autosubsync_menu_data(user_id, active_dir, page=1)

        target_out = auto_sub_sync_engine.determine_output_path(sub["path"])
        target_name = os.path.basename(target_out)

        engine_desc = (
            "<b>ffsubsync</b> (Default - Analisis VAD Audio & Framerate)"
            if engine_name == "ffsubsync"
            else "<b>autosubsync</b> (Model Machine Learning Speech Detection)"
        )

        lines = [
            "🔄 <b>Konfirmasi AutoSubSync</b>",
            "━━━━━━━━━━━━━━━━━━━━━",
            f"🎬 <b>Video:</b> <code>{escape_html(video['name'])}</code>",
            f"📊 <b>Ukuran Video:</b> {escape_html(video['formatted_size'])}",
            f"📝 <b>Subtitle Asli:</b> <code>{escape_html(sub['name'])}</code>",
            f"📊 <b>Ukuran Subtitle:</b> {escape_html(sub['formatted_size'])}",
            f"🎯 <b>File Output:</b> <code>{escape_html(target_name)}</code>",
            f"⚙️ <b>Engine:</b> {engine_desc}\n",
            "💡 <i>AutoSubSync akan mengekstrak rekaman percakapan dari video dan menyinkronkan seluruh baris subtitle dengan dialog secara otomatis.</i>\n",
            "Tekan <b>⚡ Mulai Sinkronisasi</b> untuk menjalankan proses:",
        ]
        text = "\n".join(lines)

        keyboard = [
            [InlineKeyboardButton("⚡ Mulai Sinkronisasi", callback_data="as_exec")],
            [InlineKeyboardButton(f"⚙️ Ganti Engine (Saat ini: {engine_name})", callback_data="as_toggle_engine")],
            [
                InlineKeyboardButton("📝 Ganti Subtitle", callback_data="as_back_sub"),
                InlineKeyboardButton("🎬 Ganti Video", callback_data="as_back_vid"),
            ],
            [InlineKeyboardButton("❌ Batal", callback_data="as_cancel")],
        ]
        session["timestamp"] = time.time()
        return text, InlineKeyboardMarkup(keyboard)

    # -------------------------------------------------------------
    # STEP 4: COMPLETED MENU
    # -------------------------------------------------------------
    if step == "completed":
        result: Optional[SyncResult] = session.get("last_result")
        if not result or not result.success:
            session["step"] = "pick_video"
            return build_autosubsync_menu_data(user_id, active_dir, page=1)

        offset_str = f"{result.offset_seconds:+.2f} detik" if result.offset_seconds is not None else "Otomatis"
        lines = [
            "✅ <b>AutoSubSync Berhasil!</b> 🎉",
            "━━━━━━━━━━━━━━━━━━━━━",
            f"🎬 <b>Video:</b> <code>{escape_html(os.path.basename(result.video_path))}</code>",
            f"📝 <b>Subtitle Asli:</b> <code>{escape_html(os.path.basename(result.subtitle_path))}</code>",
            f"💾 <b>File Tersinkron:</b> <code>{escape_html(os.path.basename(result.output_path or ''))}</code>",
            f"📊 <b>Ukuran:</b> {format_bytes(result.file_size)}",
            f"⏱️ <b>Waktu Proses:</b> {result.elapsed_seconds}s",
            f"⚡ <b>Offset Terdeteksi:</b> {offset_str}",
            f"⚙️ <b>Engine:</b> {result.engine_used}\n",
            f"📍 <b>Path Server:</b>\n<code>{escape_html(result.output_path or '')}</code>\n",
            "<i>Anda dapat mengunduh file subtitle tersinkron langsung ke Telegram melalui tombol di bawah:</i>",
        ]
        text = "\n".join(lines)
        keyboard = [
            [InlineKeyboardButton("📥 Kirim File Subtitle ke Chat", callback_data="as_send_sub")],
            [InlineKeyboardButton("🔄 Sinkron Subtitle Lain", callback_data="as_restart")],
            [InlineKeyboardButton("❌ Tutup", callback_data="as_cancel")],
        ]
        return text, InlineKeyboardMarkup(keyboard)

    # -------------------------------------------------------------
    # STEP 1 (Pick Video) & STEP 2 (Pick Subtitle)
    # -------------------------------------------------------------
    scan_data = scan_autosubsync_items(
        directory=active_dir,
        step=step,
        selected_video=session.get("video_item"),
    )
    items = scan_data["items"]
    auto_pairs = scan_data["auto_pairs"]
    total_items = len(items)

    total_pages = max(1, (total_items + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(1, min(page, total_pages))
    start_idx = (page - 1) * PAGE_SIZE
    end_idx = min(start_idx + PAGE_SIZE, total_items)
    page_items = items[start_idx:end_idx]

    session.update({
        "current_dir": active_dir,
        "items": items,
        "page": page,
        "total_pages": total_pages,
        "timestamp": time.time(),
    })

    lines: List[str] = [
        "🔄 <b>AutoSubSync - Sinkronisasi Subtitle Otomatis</b>",
        f"📂 <b>Folder Server:</b> <code>{escape_html(display_path)}</code>",
    ]

    if step == "pick_video":
        lines.append("🎬 <b>[Langkah 1/2] Pilih File Video Referensi:</b>\n")
        if auto_pairs:
            pair = auto_pairs[0]
            lines.append(
                f"🎯 <b>Auto-Pair Ditemukan:</b>\n"
                f"• Video: <code>{escape_html(pair['video_name'])}</code>\n"
                f"• Subtitle: <code>{escape_html(pair['subtitle_name'])}</code>\n"
            )
        lines.append(f"<b>Daftar Item (Halaman {page}/{total_pages} - Total {total_items}):</b>")
    else:
        # pick_sub
        vid_item = session.get("video_item", {})
        vid_name = vid_item.get("name", "Video")
        lines.append(f"🎬 <b>Video Terpilih:</b> <code>{escape_html(vid_name)}</code>")
        lines.append("📝 <b>[Langkah 2/2] Pilih Subtitle (.srt / .ass) yang Ingin Disinkronkan:</b>\n")
        lines.append(f"<b>Daftar Subtitle (Halaman {page}/{total_pages} - Total {total_items}):</b>")

    if total_items == 0:
        if step == "pick_video":
            lines.append("\n<i>Folder ini tidak memiliki file video (.mp4/.mkv/dll) atau subfolder.</i>")
        else:
            lines.append("\n<i>Folder ini tidak memiliki file subtitle (.srt/.ass/dll) atau subfolder.</i>")

    for idx, item in enumerate(page_items, start=1):
        if item["is_dir"]:
            icon = "📁"
            size_str = " <i>[Folder]</i>"
            match_str = ""
        else:
            if step == "pick_video":
                icon = "🎬"
                size_str = f" ({item['formatted_size']})"
                match_str = ""
            else:
                icon = "📝"
                size_str = f" ({item['formatted_size']})"
                sim = item.get("similarity", 0.0)
                if sim >= 0.70:
                    match_str = f" ⭐ <b>[Cocok {int(sim*100)}%]</b>"
                elif sim >= 0.50:
                    match_str = f" 🔹 <i>[{int(sim*100)}%]</i>"
                else:
                    match_str = ""

        lines.append(f"<b>{idx}.</b> {icon} <code>{escape_html(item['name'])}</code>{size_str}{match_str}")

    if total_items > 0:
        lines.append("\n<i>Tekan tombol angka di bawah atau ketik nomor (1-8) di chat:</i>")

    text = "\n".join(lines)

    # Number buttons (chunks of 4)
    keyboard: List[List[InlineKeyboardButton]] = []
    num_buttons: List[InlineKeyboardButton] = []
    for idx in range(1, len(page_items) + 1):
        num_buttons.append(InlineKeyboardButton(str(idx), callback_data=f"as_pick:{idx}"))

    for i in range(0, len(num_buttons), 4):
        keyboard.append(num_buttons[i:i + 4])

    # If auto-pair found on Step 1, add quick auto-sync button
    if step == "pick_video" and auto_pairs:
        keyboard.append([
            InlineKeyboardButton("⚡ Auto-Sync Pasangan Terdeteksi", callback_data="as_quick_pair:0")
        ])

    # Navigation row
    nav_row: List[InlineKeyboardButton] = []
    if page > 1:
        nav_row.append(InlineKeyboardButton("◀️ Prev", callback_data=f"as_page:{page - 1}"))
    if active_dir != base_root:
        nav_row.append(InlineKeyboardButton("⬆️ Naik", callback_data="as_cd_up"))
    if page < total_pages:
        nav_row.append(InlineKeyboardButton("Next ▶️", callback_data=f"as_page:{page + 1}"))

    if nav_row:
        keyboard.append(nav_row)

    # Bottom control row
    bottom_row: List[InlineKeyboardButton] = []
    if step == "pick_sub":
        bottom_row.append(InlineKeyboardButton("🔙 Ganti Video", callback_data="as_back_vid"))
    bottom_row.append(InlineKeyboardButton("🔄 Refresh", callback_data="as_refresh"))
    bottom_row.append(InlineKeyboardButton("❌ Batal", callback_data="as_cancel"))
    keyboard.append(bottom_row)

    return text, InlineKeyboardMarkup(keyboard)


async def process_autosubsync_choice(
    client: Client,
    message: Any,
    user_id: int,
    pick_idx: int,
    is_callback: bool = False,
):
    """Processes user selection (from button or typed number 1-8)."""
    session = autosubsync_sessions.get(user_id)
    if not session or not session.get("items"):
        err_text = "⚠️ Sesi AutoSubSync telah kedaluwarsa. Silakan ketik <code>/autosubsync</code> kembali."
        if is_callback:
            await message.answer(err_text, show_alert=True)
        else:
            await message.reply_text(err_text)
        return

    items = session["items"]
    page = session.get("page", 1)
    real_idx = (page - 1) * PAGE_SIZE + (pick_idx - 1)

    if real_idx < 0 or real_idx >= len(items):
        err_text = f"⚠️ Pilihan nomor {pick_idx} tidak valid."
        if is_callback:
            await message.answer(err_text, show_alert=True)
        else:
            await message.reply_text(err_text)
        return

    selected = items[real_idx]
    step = session.get("step", "pick_video")

    # If selected item is a folder: enter it and reload current step
    if selected["is_dir"]:
        session["current_dir"] = selected["path"]
        session["page"] = 1
        text, markup = build_autosubsync_menu_data(user_id, current_dir=selected["path"], page=1)
        if is_callback:
            await message.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
            await message.answer()
        else:
            await message.reply_text(text, reply_markup=markup, disable_web_page_preview=True)
        return

    # If Step 1 (pick video): select video, transition to Step 2 (pick subtitle)
    if step == "pick_video":
        session["video_item"] = selected
        session["step"] = "pick_sub"
        session["page"] = 1
        text, markup = build_autosubsync_menu_data(user_id, current_dir=session["current_dir"], page=1)
        if is_callback:
            await message.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
            await message.answer("Video dipilih! Silakan pilih Subtitle.")
        else:
            await message.reply_text(text, reply_markup=markup, disable_web_page_preview=True)
        return

    # If Step 2 (pick subtitle): select subtitle, transition to Step 3 (confirmation)
    if step == "pick_sub":
        session["sub_item"] = selected
        session["step"] = "confirm"
        text, markup = build_autosubsync_menu_data(user_id, current_dir=session["current_dir"], page=1)
        if is_callback:
            await message.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
            await message.answer("Subtitle dipilih!")
        else:
            await message.reply_text(text, reply_markup=markup, disable_web_page_preview=True)
        return


async def track_autosubsync_task(
    client: Client,
    status_msg: Message,
    user_id: int,
    video_item: Dict[str, Any],
    sub_item: Dict[str, Any],
    engine: str,
):
    """Executes AutoSubSync in background and updates status message."""
    session = autosubsync_sessions.get(user_id)
    video_path = video_item["path"]
    sub_path = sub_item["path"]
    video_name = video_item["name"]
    sub_name = sub_item["name"]

    last_text = ""
    current_pct = 15.0

    def progress_callback(status_desc: str, pct: float):
        nonlocal current_pct
        current_pct = pct

    # Start sync task in background
    sync_future = asyncio.create_task(
        auto_sub_sync_engine.sync_subtitles(
            video_path=video_path,
            subtitle_path=sub_path,
            engine=engine,
            progress_cb=progress_callback,
        )
    )

    stage_labels = [
        "Mengekstrak audio percakapan...",
        "Mendeteksi pola suara (Voice Activity Detection)...",
        "Menghitung pergeseran waktu (time shift offset)...",
        "Menyelaraskan teks subtitle...",
    ]
    stage_idx = 0

    while not sync_future.done():
        await asyncio.sleep(2.5)
        if sync_future.done():
            break

        stage_desc = stage_labels[min(stage_idx, len(stage_labels) - 1)]
        stage_idx += 1
        current_pct = min(92.0, current_pct + 12.0)
        bar = make_square_progress_bar(current_pct)

        text = (
            "⏳ <b>AutoSubSync Sedang Berjalan...</b>\n\n"
            f"🎬 <b>Video:</b> <code>{escape_html(video_name)}</code>\n"
            f"📝 <b>Subtitle:</b> <code>{escape_html(sub_name)}</code>\n"
            f"⚙️ <b>Engine:</b> <code>{escape_html(engine)}</code>\n\n"
            f"{bar}\n\n"
            f"🎙️ Status: <i>{escape_html(stage_desc)}</i>"
        )
        if text != last_text:
            try:
                await status_msg.edit_text(text)
                last_text = text
            except Exception:
                pass

    try:
        result: SyncResult = await sync_future
    except Exception as exc:
        logger.error(f"AutoSubSync task exception: {exc}", exc_info=True)
        result = SyncResult(
            success=False,
            video_path=video_path,
            subtitle_path=sub_path,
            engine_used=engine,
            error=str(exc),
        )

    if session:
        session["last_result"] = result
        session["step"] = "completed" if result.success else "confirm"

    if result.success:
        text, markup = build_autosubsync_menu_data(user_id)
        try:
            await status_msg.edit_text(text, reply_markup=markup, disable_web_page_preview=True)
        except Exception:
            pass
    else:
        err_msg = result.error or "Terjadi kesalahan yang tidak diketahui saat proses sinkronisasi."
        text = (
            "❌ <b>AutoSubSync Gagal</b>\n\n"
            f"🎬 <b>Video:</b> <code>{escape_html(video_name)}</code>\n"
            f"📝 <b>Subtitle:</b> <code>{escape_html(sub_name)}</code>\n\n"
            f"⚠️ <b>Penyebab Kesalahan:</b>\n"
            f"<code>{escape_html(str(err_msg)[:500])}</code>\n\n"
            "💡 <i>Saran perbaikan:</i>\n"
            "• Pastikan file video memiliki track audio yang valid.\n"
            "• Coba ganti engine sinkronisasi ke <b>autosubsync</b> atau sebaliknya.\n"
            "• Pastikan format subtitle adalah .srt atau .ass yang valid."
        )
        keyboard = [
            [InlineKeyboardButton("🔄 Coba Lagi", callback_data="as_exec")],
            [InlineKeyboardButton("⚙️ Ganti Engine", callback_data="as_toggle_engine")],
            [InlineKeyboardButton("📝 Ganti Subtitle", callback_data="as_back_sub")],
            [InlineKeyboardButton("❌ Batal", callback_data="as_cancel")],
        ]
        try:
            await status_msg.edit_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
        except Exception:
            pass


# -----------------------------------------------------------------
# PYROGRAM HANDLERS
# -----------------------------------------------------------------


@Client.on_message(filters.command(["autosubsync"]))
@new_task
async def autosubsync_command_handler(client: Client, message: Message):
    """Handles /autosubsync command to start subtitle synchronization wizard."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await send_message(
            message,
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan perintah ini.",
        )
        return

    # Check optional argument: e.g. /autosubsync 2 or /autosubsync /path/video.mkv
    cmd_parts = (message.text or "").split(maxsplit=1)
    arg = cmd_parts[1].strip() if len(cmd_parts) > 1 else ""

    session = autosubsync_sessions.get(user_id)

    # If user provided a numeric argument and has an active list, pick directly
    if arg.isdigit() and session and session.get("items"):
        idx = int(arg)
        await process_autosubsync_choice(client, message, user_id, idx, is_callback=False)
        return

    # If user provided a file path directly
    if arg and os.path.isfile(arg):
        base_root = get_base_save_path()
        abs_path = os.path.realpath(arg)
        if auto_sub_sync_engine.is_video(abs_path):
            autosubsync_sessions[user_id] = {
                "current_dir": os.path.dirname(abs_path),
                "step": "pick_sub",
                "page": 1,
                "video_item": {
                    "name": os.path.basename(abs_path),
                    "path": abs_path,
                    "is_dir": False,
                    "size": os.path.getsize(abs_path),
                    "formatted_size": format_bytes(os.path.getsize(abs_path)),
                },
                "sub_item": None,
                "engine": "ffsubsync",
                "timestamp": time.time(),
                "items": [],
                "last_result": None,
            }
            text, keyboard = build_autosubsync_menu_data(user_id, current_dir=os.path.dirname(abs_path), page=1)
            await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)
            return

    # Start wizard from Step 1 (Pick Video)
    autosubsync_sessions[user_id] = {
        "current_dir": get_base_save_path(),
        "step": "pick_video",
        "page": 1,
        "video_item": None,
        "sub_item": None,
        "engine": "ffsubsync",
        "timestamp": time.time(),
        "items": [],
        "last_result": None,
    }
    text, keyboard = build_autosubsync_menu_data(user_id, current_dir=None, page=1)
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


@Client.on_callback_query(filters.regex(r"^as_pick:(\d+)"))
async def autosubsync_pick_callback(client: Client, callback_query: CallbackQuery):
    """Handles item selection button."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    idx = int(callback_query.matches[0].group(1))
    await process_autosubsync_choice(client, callback_query, user_id, idx, is_callback=True)


@Client.on_callback_query(filters.regex(r"^as_quick_pair:(\d+)"))
async def autosubsync_quick_pair_callback(client: Client, callback_query: CallbackQuery):
    """Jumps straight to confirmation for an auto-detected matching pair."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    if not session:
        await callback_query.answer("⚠️ Sesi kedaluwarsa.", show_alert=True)
        return

    scan_data = scan_autosubsync_items(
        directory=session.get("current_dir", get_base_save_path()),
        step="pick_video",
    )
    auto_pairs = scan_data.get("auto_pairs", [])
    pair_idx = int(callback_query.matches[0].group(1))

    if pair_idx < 0 or pair_idx >= len(auto_pairs):
        await callback_query.answer("⚠️ Pasangan tidak ditemukan.", show_alert=True)
        return

    pair = auto_pairs[pair_idx]
    vid_path = pair["video"]
    sub_path = pair["subtitle"]

    vid_size = os.path.getsize(vid_path) if os.path.exists(vid_path) else 0
    sub_size = os.path.getsize(sub_path) if os.path.exists(sub_path) else 0

    session["video_item"] = {
        "name": pair["video_name"],
        "path": vid_path,
        "is_dir": False,
        "size": vid_size,
        "formatted_size": format_bytes(vid_size),
    }
    session["sub_item"] = {
        "name": pair["subtitle_name"],
        "path": sub_path,
        "is_dir": False,
        "size": sub_size,
        "formatted_size": format_bytes(sub_size),
    }
    session["step"] = "confirm"

    text, markup = build_autosubsync_menu_data(user_id)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer("Auto-Pair dipilih!")


@Client.on_callback_query(filters.regex(r"^as_exec$"))
async def autosubsync_exec_callback(client: Client, callback_query: CallbackQuery):
    """Starts synchronization execution."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    if not session or not session.get("video_item") or not session.get("sub_item"):
        await callback_query.answer("⚠️ Sesi tidak valid. Silakan mulai ulang.", show_alert=True)
        return

    await callback_query.answer("Memulai sinkronisasi...", show_alert=False)
    status_msg = callback_query.message

    video_item = session["video_item"]
    sub_item = session["sub_item"]
    engine = session.get("engine", "ffsubsync")

    init_text = (
        "⏳ <b>Memulai AutoSubSync...</b>\n\n"
        f"🎬 <b>Video:</b> <code>{escape_html(video_item['name'])}</code>\n"
        f"📝 <b>Subtitle:</b> <code>{escape_html(sub_item['name'])}</code>\n"
        f"⚙️ <b>Engine:</b> <code>{escape_html(engine)}</code>\n\n"
        f"{make_square_progress_bar(10)}\n\n"
        "⏳ Status: <i>Menyiapkan FFmpeg & mengekstrak audio...</i>"
    )
    await status_msg.edit_text(init_text)

    asyncio.create_task(
        track_autosubsync_task(
            client=client,
            status_msg=status_msg,
            user_id=user_id,
            video_item=video_item,
            sub_item=sub_item,
            engine=engine,
        )
    )


@Client.on_callback_query(filters.regex(r"^as_toggle_engine$"))
async def autosubsync_toggle_engine_callback(client: Client, callback_query: CallbackQuery):
    """Toggles between ffsubsync and autosubsync engines."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    if not session:
        await callback_query.answer("⚠️ Sesi kedaluwarsa.", show_alert=True)
        return

    current = session.get("engine", "ffsubsync")
    new_engine = "autosubsync" if current == "ffsubsync" else "ffsubsync"
    session["engine"] = new_engine

    text, markup = build_autosubsync_menu_data(user_id)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer(f"Engine diubah ke: {new_engine}")


@Client.on_callback_query(filters.regex(r"^as_back_vid$"))
async def autosubsync_back_vid_callback(client: Client, callback_query: CallbackQuery):
    """Goes back to Step 1 (Pick Video)."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    if not session:
        await callback_query.answer("⚠️ Sesi kedaluwarsa.", show_alert=True)
        return

    session["step"] = "pick_video"
    session["page"] = 1
    text, markup = build_autosubsync_menu_data(user_id, page=1)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^as_back_sub$"))
async def autosubsync_back_sub_callback(client: Client, callback_query: CallbackQuery):
    """Goes back to Step 2 (Pick Subtitle)."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    if not session:
        await callback_query.answer("⚠️ Sesi kedaluwarsa.", show_alert=True)
        return

    session["step"] = "pick_sub"
    session["page"] = 1
    text, markup = build_autosubsync_menu_data(user_id, page=1)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^as_cd_up$"))
async def autosubsync_cd_up_callback(client: Client, callback_query: CallbackQuery):
    """Navigates one level up to parent directory."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    base_root = get_base_save_path()
    current_dir = session.get("current_dir", base_root) if session else base_root
    parent_dir = os.path.dirname(current_dir)

    try:
        if os.path.commonpath([base_root, parent_dir]) != base_root:
            parent_dir = base_root
    except ValueError:
        parent_dir = base_root

    text, markup = build_autosubsync_menu_data(user_id, current_dir=parent_dir, page=1)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^as_page:(\d+)"))
async def autosubsync_page_callback(client: Client, callback_query: CallbackQuery):
    """Navigates to another page."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    page = int(callback_query.matches[0].group(1))
    text, markup = build_autosubsync_menu_data(user_id, page=page)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^as_refresh$"))
async def autosubsync_refresh_callback(client: Client, callback_query: CallbackQuery):
    """Refreshes file and directory list."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    text, markup = build_autosubsync_menu_data(user_id)
    try:
        await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
        await callback_query.answer("Daftar file diperbarui! 🔄")
    except Exception:
        await callback_query.answer("Data sudah paling baru 👍")


@Client.on_callback_query(filters.regex(r"^as_send_sub$"))
async def autosubsync_send_sub_callback(client: Client, callback_query: CallbackQuery):
    """Sends the synchronized subtitle file as an attachment to Telegram chat."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = autosubsync_sessions.get(user_id)
    result: Optional[SyncResult] = session.get("last_result") if session else None

    if not result or not result.output_path or not os.path.isfile(result.output_path):
        await callback_query.answer("⚠️ File subtitle tidak ditemukan.", show_alert=True)
        return

    await callback_query.answer("Mengirim file subtitle...", show_alert=False)
    caption = (
        f"📝 <b>Subtitle Tersinkron</b>\n"
        f"🎬 <b>Video:</b> <code>{escape_html(os.path.basename(result.video_path))}</code>\n"
        f"⚡ <b>Engine:</b> {result.engine_used}"
    )
    await send_file(callback_query.message, result.output_path, caption=caption)


@Client.on_callback_query(filters.regex(r"^as_restart$"))
async def autosubsync_restart_callback(client: Client, callback_query: CallbackQuery):
    """Restarts wizard from Step 1."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    autosubsync_sessions[user_id] = {
        "current_dir": get_base_save_path(),
        "step": "pick_video",
        "page": 1,
        "video_item": None,
        "sub_item": None,
        "engine": "ffsubsync",
        "timestamp": time.time(),
        "items": [],
        "last_result": None,
    }
    text, markup = build_autosubsync_menu_data(user_id, current_dir=None, page=1)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^as_cancel$"))
async def autosubsync_cancel_callback(client: Client, callback_query: CallbackQuery):
    """Cancels and exits AutoSubSync menu."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    autosubsync_sessions.pop(user_id, None)
    await callback_query.edit_message_text("❌ <b>Menu AutoSubSync dibatalkan.</b>")
    await callback_query.answer("Dibatalkan.")


@Client.on_callback_query(filters.regex(r"^as_start$"))
async def autosubsync_start_callback(client: Client, callback_query: CallbackQuery):
    """Opens AutoSubSync from /start inline button."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    autosubsync_sessions[user_id] = {
        "current_dir": get_base_save_path(),
        "step": "pick_video",
        "page": 1,
        "video_item": None,
        "sub_item": None,
        "engine": "ffsubsync",
        "timestamp": time.time(),
        "items": [],
        "last_result": None,
    }
    text, markup = build_autosubsync_menu_data(user_id, current_dir=None, page=1)
    await callback_query.edit_message_text(text, reply_markup=markup, disable_web_page_preview=True)
    await callback_query.answer()
