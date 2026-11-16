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
from app.services.gdrive_service import gdrive_service
from bot import LOGGER
from bot.utils import (
    escape_html,
    format_bytes,
    format_duration_id,
    format_speed,
    is_user_authorized,
    make_square_progress_bar,
    new_task,
    send_message,
)

logger = LOGGER or logging.getLogger(__name__)

# User sessions: user_id -> dict
upload_sessions: Dict[int, Dict[str, Any]] = {}
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


def scan_local_items(directory: str) -> List[Dict[str, Any]]:
    """Scans files and subdirectories in the specified directory."""
    base_root = get_base_save_path()
    real_dir = os.path.realpath(directory)
    try:
        if os.path.commonpath([base_root, real_dir]) != base_root:
            real_dir = base_root
    except ValueError:
        real_dir = base_root

    items: List[Dict[str, Any]] = []
    if not os.path.exists(real_dir):
        return items

    try:
        with os.scandir(real_dir) as entries:
            for entry in entries:
                try:
                    is_dir = entry.is_dir(follow_symlinks=True)
                    size = 0 if is_dir else entry.stat().st_size
                    items.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": is_dir,
                        "size": size,
                        "formatted_size": "Folder" if is_dir else format_bytes(size),
                    })
                except Exception:
                    continue
    except Exception as exc:
        logger.warning(f"Error scanning directory '{real_dir}': {exc}")

    # Sort: folders first (alphabetical), then files (alphabetical)
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    return items


def build_upload_menu_data(user_id: int, current_dir: Optional[str] = None, page: int = 1) -> tuple[str, Optional[InlineKeyboardMarkup]]:
    """Builds text and inline keyboard markup for local server file selection."""
    if not gdrive_service.is_authenticated():
        text = (
            "⚠️ <b>Google Drive Belum Terhubung</b>\n\n"
            "Server belum terhubung ke akun Google Drive Anda.\n"
            "Silakan buka Web UI pada halaman <b>Google Drive</b> (<code>/drive</code>) "
            "untuk menghubungkan akun Google Drive terlebih dahulu."
        )
        return text, None

    base_root = get_base_save_path()
    if not current_dir:
        current_dir = base_root
    current_dir = os.path.realpath(current_dir)
    try:
        if os.path.commonpath([base_root, current_dir]) != base_root:
            current_dir = base_root
    except ValueError:
        current_dir = base_root

    items = scan_local_items(current_dir)
    total_items = len(items)

    # Destination folder info
    dest_info = gdrive_service.get_default_path()
    dest_name = dest_info.get("folder_name") or "Root (My Drive)"
    dest_id = dest_info.get("folder_id") or "root"

    # Display relative path for cleanliness
    rel_path = os.path.relpath(current_dir, base_root)
    display_path = "/" if rel_path == "." else f"/{rel_path.replace(os.sep, '/')}"

    if total_items == 0:
        text = (
            "📤 <b>Upload ke Google Drive</b>\n\n"
            f"📂 <b>Folder Server:</b> <code>{escape_html(display_path)}</code>\n"
            f"🎯 <b>Tujuan Drive:</b> <b>{escape_html(dest_name)}</b>\n\n"
            "<i>Folder server ini masih kosong (belum ada file atau folder).</i>"
        )
        buttons = []
        if current_dir != base_root:
            parent_dir = os.path.dirname(current_dir)
            buttons.append([InlineKeyboardButton("⬆️ Naik Folder", callback_data="up_cd_up")])
        buttons.append([
            InlineKeyboardButton("🔄 Refresh", callback_data="up_refresh"),
            InlineKeyboardButton("❌ Tutup", callback_data="up_cancel"),
        ])
        # Save session
        upload_sessions[user_id] = {
            "current_dir": current_dir,
            "items": [],
            "page": 1,
            "total_pages": 1,
            "dest_id": dest_id,
            "dest_name": dest_name,
            "timestamp": time.time(),
        }
        return text, InlineKeyboardMarkup(buttons)

    total_pages = max(1, (total_items + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(1, min(page, total_pages))

    start_idx = (page - 1) * PAGE_SIZE
    end_idx = min(start_idx + PAGE_SIZE, total_items)
    page_items = items[start_idx:end_idx]

    # Save session
    upload_sessions[user_id] = {
        "current_dir": current_dir,
        "items": items,
        "page": page,
        "total_pages": total_pages,
        "dest_id": dest_id,
        "dest_name": dest_name,
        "timestamp": time.time(),
    }

    # Build message text
    lines = [
        "📤 <b>Pilih File atau Folder untuk Di-upload ke Google Drive:</b>",
        f"📂 <b>Folder Server:</b> <code>{escape_html(display_path)}</code>",
        f"🎯 <b>Tujuan Drive:</b> <b>{escape_html(dest_name)}</b>\n",
        f"<b>Daftar Item (Halaman {page}/{total_pages} - Total {total_items}):</b>",
    ]

    for idx, item in enumerate(page_items, start=1):
        icon = "📁" if item["is_dir"] else ("🎬" if item["name"].lower().endswith((".mkv", ".mp4", ".avi", ".ts")) else "📄")
        size_str = f" ({item['formatted_size']})" if not item["is_dir"] else " <i>[Folder]</i>"
        lines.append(f"<b>{idx}.</b> {icon} <code>{escape_html(item['name'])}</code>{size_str}")

    lines.append("\n<i>Tekan tombol angka di bawah atau ketik nomor (1-8) di chat:</i>")
    text = "\n".join(lines)

    # Build number buttons (e.g. 1..4 in row 1, 5..8 in row 2)
    keyboard: List[List[InlineKeyboardButton]] = []
    num_buttons: List[InlineKeyboardButton] = []
    for idx in range(1, len(page_items) + 1):
        num_buttons.append(InlineKeyboardButton(str(idx), callback_data=f"up_pick:{idx}"))

    # Split into chunks of 4
    for i in range(0, len(num_buttons), 4):
        keyboard.append(num_buttons[i:i + 4])

    # Navigation buttons
    nav_row: List[InlineKeyboardButton] = []
    if page > 1:
        nav_row.append(InlineKeyboardButton("◀️ Prev", callback_data=f"up_page:{page - 1}"))
    if current_dir != base_root:
        nav_row.append(InlineKeyboardButton("⬆️ Naik", callback_data="up_cd_up"))
    if page < total_pages:
        nav_row.append(InlineKeyboardButton("Next ▶️", callback_data=f"up_page:{page + 1}"))

    if nav_row:
        keyboard.append(nav_row)

    keyboard.append([
        InlineKeyboardButton("🔄 Refresh", callback_data="up_refresh"),
        InlineKeyboardButton("❌ Batal", callback_data="up_cancel"),
    ])

    return text, InlineKeyboardMarkup(keyboard)


async def track_upload_progress(client: Client, message: Message, upload_id: str, item_name: str, total_bytes: int):
    """Monitors background Google Drive upload task and updates progress message."""
    last_text = ""
    start_time = time.time()

    while True:
        await asyncio.sleep(2.5)
        progress = gdrive_service.get_upload_progress(upload_id)
        if not progress:
            break

        status = progress.get("status", "uploading")
        pct = float(progress.get("progress_percent", 0.0) or 0.0)
        uploaded = int(progress.get("bytes_uploaded", 0) or 0)
        tot = int(progress.get("total_bytes", total_bytes) or total_bytes)
        elapsed = max(1.0, time.time() - start_time)
        speed = uploaded / elapsed if uploaded > 0 else 0

        if status == "completed":
            text = (
                "✅ <b>Upload ke Google Drive Berhasil!</b> 🎉\n\n"
                f"📄 <b>Item:</b> <code>{escape_html(item_name)}</code>\n"
                f"📊 <b>Ukuran:</b> {format_bytes(tot)}\n"
                f"⏱️ <b>Waktu:</b> {format_duration_id(elapsed)}\n"
                f"🆔 <b>Drive File ID:</b> <code>{escape_html(str(progress.get('drive_file_id', '-')))}</code>"
            )
            try:
                await message.edit_text(text)
            except Exception:
                pass
            break

        if status == "failed":
            err = progress.get("error") or "Terjadi kesalahan saat mengunggah."
            text = (
                "❌ <b>Upload ke Google Drive Gagal</b>\n\n"
                f"📄 <b>Item:</b> <code>{escape_html(item_name)}</code>\n"
                f"⚠️ <b>Penyebab:</b> <code>{escape_html(str(err))}</code>"
            )
            try:
                await message.edit_text(text)
            except Exception:
                pass
            break

        bar = make_square_progress_bar(pct)
        text = (
            "📤 <b>Mengunggah ke Google Drive...</b>\n\n"
            f"📄 <b>Item:</b> <code>{escape_html(item_name)}</code>\n"
            f"📊 <b>Progres:</b> {format_bytes(uploaded)} / {format_bytes(tot)} ({pct:.1f}%)\n"
            f"⚡ <b>Kecepatan:</b> {format_speed(speed)}\n"
            f"{bar}\n\n"
            f"⏳ Status: <i>Sedang mengunggah...</i>"
        )
        if text != last_text:
            try:
                await message.edit_text(text)
                last_text = text
            except Exception:
                pass


@Client.on_message(filters.command(["upload"]))
@new_task
async def upload_command_handler(client: Client, message: Message):
    """Handles /upload command to list local server files and initiate upload."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await send_message(
            message,
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan perintah ini.",
        )
        return

    # Check optional argument: e.g. /upload 2 or /upload folder_name
    cmd_parts = (message.text or "").split(maxsplit=1)
    arg = cmd_parts[1].strip() if len(cmd_parts) > 1 else ""

    session = upload_sessions.get(user_id)
    # If user provided a numeric argument and has an active list, pick directly
    if arg.isdigit() and session and session.get("items"):
        idx = int(arg)
        await process_upload_choice(client, message, user_id, idx, is_callback=False)
        return

    text, keyboard = build_upload_menu_data(user_id, current_dir=None, page=1)
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


async def process_upload_choice(
    client: Client,
    message: Any,
    user_id: int,
    pick_idx: int,
    is_callback: bool = False,
):
    """Processes user selection (either from button or text reply)."""
    session = upload_sessions.get(user_id)
    if not session or not session.get("items"):
        err_text = "⚠️ Sesi upload telah kadaluarsa. Silakan ketik <code>/upload</code> kembali."
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
    dest_id = session.get("dest_id") or "root"
    dest_name = session.get("dest_name") or "Root"

    # If selected item is a folder: offer to upload whole folder or open it
    if selected["is_dir"]:
        prompt_text = (
            f"📁 <b>Folder Dipilih:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"📍 <b>Path Server:</b> <code>{escape_html(selected['path'])}</code>\n"
            f"🎯 <b>Tujuan Drive:</b> <b>{escape_html(dest_name)}</b>\n\n"
            "Pilih tindakan yang ingin dilakukan:"
        )
        buttons = [
            [InlineKeyboardButton("⬆️ Upload Seluruh Folder Ini", callback_data=f"up_exec:{real_idx}")],
            [InlineKeyboardButton("📂 Buka & Jelajahi Folder", callback_data=f"up_cd_idx:{real_idx}")],
            [InlineKeyboardButton("🔙 Kembali ke Daftar", callback_data=f"up_page:{page}")],
        ]
        markup = InlineKeyboardMarkup(buttons)
        if is_callback:
            await message.edit_message_text(prompt_text, reply_markup=markup)
            await message.answer()
        else:
            await message.reply_text(prompt_text, reply_markup=markup)
        return

    # If selected item is a file: initiate upload immediately
    if is_callback:
        status_msg = message.message
        await message.answer("Memulai upload...", show_alert=False)
    else:
        status_msg = await message.reply_text("⏳ Menyiapkan upload ke Google Drive...")

    try:
        upload_id = gdrive_service.start_resumable_upload(
            file_path=selected["path"],
            folder_id=dest_id,
        )
        init_text = (
            f"🚀 <b>Memulai Upload ke Google Drive</b>\n\n"
            f"📄 <b>File:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"📊 <b>Ukuran:</b> {format_bytes(selected['size'])}\n"
            f"🎯 <b>Tujuan:</b> <b>{escape_html(dest_name)}</b>\n\n"
            f"{make_square_progress_bar(0)}\n\n"
            "⏳ Status: <i>Menghubungi Google Drive...</i>"
        )
        await status_msg.edit_text(init_text)
        asyncio.create_task(
            track_upload_progress(
                client,
                status_msg,
                upload_id,
                selected["name"],
                selected["size"],
            )
        )
    except Exception as exc:
        logger.error(f"Failed to start upload: {exc}", exc_info=True)
        await status_msg.edit_text(f"❌ <b>Gagal Memulai Upload:</b>\n<code>{escape_html(str(exc))}</code>")


@Client.on_callback_query(filters.regex(r"^up_pick:(\d+)"))
async def upload_pick_callback(client: Client, callback_query: CallbackQuery):
    """Handles button press selecting an item number."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    idx = int(callback_query.matches[0].group(1))
    await process_upload_choice(client, callback_query, user_id, idx, is_callback=True)


@Client.on_callback_query(filters.regex(r"^up_exec:(\d+)"))
async def upload_exec_folder_callback(client: Client, callback_query: CallbackQuery):
    """Executes upload of an entire directory."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = upload_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    selected = session["items"][real_idx]
    dest_id = session.get("dest_id") or "root"
    dest_name = session.get("dest_name") or "Root"

    await callback_query.answer("Memulai upload folder...", show_alert=False)
    status_msg = callback_query.message

    try:
        upload_id = gdrive_service.start_resumable_upload(
            file_path=selected["path"],
            folder_id=dest_id,
        )
        init_text = (
            f"🚀 <b>Memulai Upload Folder ke Google Drive</b>\n\n"
            f"📁 <b>Folder:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"🎯 <b>Tujuan:</b> <b>{escape_html(dest_name)}</b>\n\n"
            f"{make_square_progress_bar(0)}\n\n"
            "⏳ Status: <i>Menghitung file & memulai upload...</i>"
        )
        await status_msg.edit_text(init_text)
        asyncio.create_task(
            track_upload_progress(
                client,
                status_msg,
                upload_id,
                selected["name"],
                selected["size"],
            )
        )
    except Exception as exc:
        logger.error(f"Failed to start folder upload: {exc}", exc_info=True)
        await status_msg.edit_text(f"❌ <b>Gagal Memulai Upload:</b>\n<code>{escape_html(str(exc))}</code>")


@Client.on_callback_query(filters.regex(r"^up_cd_idx:(\d+)"))
async def upload_cd_idx_callback(client: Client, callback_query: CallbackQuery):
    """Opens and enters into a subfolder."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = upload_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    target_dir = session["items"][real_idx]["path"]
    text, keyboard = build_upload_menu_data(user_id, current_dir=target_dir, page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^up_cd_up$"))
async def upload_cd_up_callback(client: Client, callback_query: CallbackQuery):
    """Navigates one level up to the parent directory."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = upload_sessions.get(user_id)
    base_root = get_base_save_path()
    current_dir = session.get("current_dir", base_root) if session else base_root
    parent_dir = os.path.dirname(current_dir)

    try:
        if os.path.commonpath([base_root, parent_dir]) != base_root:
            parent_dir = base_root
    except ValueError:
        parent_dir = base_root

    text, keyboard = build_upload_menu_data(user_id, current_dir=parent_dir, page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^up_page:(\d+)"))
async def upload_page_callback(client: Client, callback_query: CallbackQuery):
    """Navigates to another page."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    page = int(callback_query.matches[0].group(1))
    session = upload_sessions.get(user_id)
    current_dir = session.get("current_dir") if session else None

    text, keyboard = build_upload_menu_data(user_id, current_dir=current_dir, page=page)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^up_refresh$"))
async def upload_refresh_callback(client: Client, callback_query: CallbackQuery):
    """Refreshes the file list."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = upload_sessions.get(user_id)
    current_dir = session.get("current_dir") if session else None
    page = session.get("page", 1) if session else 1

    text, keyboard = build_upload_menu_data(user_id, current_dir=current_dir, page=page)
    try:
        await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
        await callback_query.answer("Daftar file diperbarui! 🔄")
    except Exception:
        await callback_query.answer("Data sudah paling baru 👍")


@Client.on_callback_query(filters.regex(r"^up_cancel$"))
async def upload_cancel_callback(client: Client, callback_query: CallbackQuery):
    """Closes and cancels the upload menu."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    upload_sessions.pop(user_id, None)
    await callback_query.edit_message_text("❌ <b>Menu upload dibatalkan.</b>")
    await callback_query.answer("Dibatalkan.")


@Client.on_callback_query(filters.regex(r"^up_start$"))
async def upload_start_callback(client: Client, callback_query: CallbackQuery):
    """Opens upload menu from start button."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    text, keyboard = build_upload_menu_data(user_id, current_dir=None, page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_message(filters.regex(r"^[1-8]$") & filters.text & ~filters.command(["upload", "copy", "delete", "start", "help", "status", "shell", "sh"]))
@new_task
async def number_choice_message_handler(client: Client, message: Message):
    """Allows user to select an item by simply typing the number (1-8) in chat."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        return

    text = (message.text or "").strip()
    if not text.isdigit():
        return

    idx = int(text)
    now = time.time()
    up_sess = upload_sessions.get(user_id)

    # Safely import copy_sessions
    try:
        from bot.command.copy import copy_sessions, process_copy_choice
    except ImportError:
        copy_sessions = {}
        process_copy_choice = None

    # Safely import delete_sessions
    try:
        from bot.command.delete import delete_sessions, process_delete_choice
    except ImportError:
        delete_sessions = {}
        process_delete_choice = None

    cp_sess = copy_sessions.get(user_id) if copy_sessions else None
    del_sess = delete_sessions.get(user_id) if delete_sessions else None

    up_time = up_sess.get("timestamp", 0) if up_sess else 0
    cp_time = cp_sess.get("timestamp", 0) if cp_sess else 0
    del_time = del_sess.get("timestamp", 0) if del_sess else 0

    # Pick whichever menu was opened more recently and within 5 minutes (300s)
    max_time = max(up_time, cp_time, del_time)
    if max_time == 0 or (now - max_time) >= 300:
        return

    if max_time == del_time and process_delete_choice:
        await process_delete_choice(client, message, user_id, idx, is_callback=False)
    elif max_time == cp_time and process_copy_choice:
        await process_copy_choice(client, message, user_id, idx, is_callback=False)
    elif max_time == up_time:
        await process_upload_choice(client, message, user_id, idx, is_callback=False)
