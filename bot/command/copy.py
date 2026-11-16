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
    format_speed,
    is_user_authorized,
    make_square_progress_bar,
    new_task,
    send_message,
)

logger = LOGGER or logging.getLogger(__name__)

# User sessions: user_id -> dict
copy_sessions: Dict[int, Dict[str, Any]] = {}
PAGE_SIZE = 8


def get_base_save_path() -> str:
    """Returns the base download directory where files from Drive will be copied."""
    raw = getattr(settings, "DEFAULT_SAVE_PATH", "/downloads") or "/downloads"
    path = os.path.realpath(raw)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        pass
    return path


def fetch_drive_items(folder_id: str = "root", query: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetches and sorts items from Google Drive."""
    try:
        if query:
            clean_query = query.replace("'", "\\'")
            drive_res = gdrive_service.list_files(query=f"name contains '{clean_query}'", page_size=40)
        else:
            drive_res = gdrive_service.list_files(folder_id=folder_id, page_size=40)
    except Exception as exc:
        logger.error(f"Error listing files from Google Drive: {exc}")
        return []

    raw_files = drive_res.get("files", [])
    items: List[Dict[str, Any]] = []

    for f in raw_files:
        mime = f.get("mime_type") or f.get("mimeType") or ""
        is_dir = mime == "application/vnd.google-apps.folder"
        raw_size = f.get("size")
        try:
            size_int = int(raw_size) if raw_size is not None else 0
        except (ValueError, TypeError):
            size_int = 0

        items.append({
            "id": f.get("id"),
            "name": f.get("name") or "Unnamed",
            "is_dir": is_dir,
            "size": size_int,
            "mime_type": mime,
            "formatted_size": "Folder" if is_dir else format_bytes(size_int),
        })

    # Sort: folders first (alphabetical), then files (alphabetical)
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    return items


def build_copy_menu_data(
    user_id: int,
    folder_id: str = "root",
    folder_name: str = "My Drive",
    folder_stack: Optional[List[tuple[str, str]]] = None,
    page: int = 1,
    query: Optional[str] = None,
) -> tuple[str, Optional[InlineKeyboardMarkup]]:
    """Builds text and inline keyboard markup for Google Drive file selection."""
    if not gdrive_service.is_authenticated():
        text = (
            "⚠️ <b>Google Drive Belum Terhubung</b>\n\n"
            "Server belum terhubung ke akun Google Drive Anda.\n"
            "Silakan buka Web UI pada halaman <b>Google Drive</b> (<code>/drive</code>) "
            "untuk menghubungkan akun Google Drive terlebih dahulu."
        )
        return text, None

    if folder_stack is None:
        folder_stack = [("root", "My Drive")]

    items = fetch_drive_items(folder_id=folder_id, query=query)
    total_items = len(items)
    dest_path = get_base_save_path()

    if total_items == 0:
        if query:
            empty_msg = f"<i>Tidak ditemukan file yang cocok dengan pencarian:</i> <code>{escape_html(query)}</code>"
        else:
            empty_msg = "<i>Folder Drive ini kosong.</i>"

        text = (
            "📥 <b>Copy dari Google Drive ke Server</b>\n\n"
            f"📁 <b>Folder Drive:</b> <b>{escape_html(folder_name)}</b>\n"
            f"💾 <b>Tujuan Server:</b> <code>{escape_html(dest_path)}</code>\n\n"
            f"{empty_msg}"
        )
        buttons = []
        if len(folder_stack) > 1 and not query:
            buttons.append([InlineKeyboardButton("⬆️ Folder Atas", callback_data="cp_cd_up")])
        buttons.append([
            InlineKeyboardButton("🔄 Refresh", callback_data="cp_refresh"),
            InlineKeyboardButton("❌ Tutup", callback_data="cp_cancel"),
        ])
        copy_sessions[user_id] = {
            "folder_id": folder_id,
            "folder_name": folder_name,
            "folder_stack": folder_stack,
            "items": [],
            "page": 1,
            "total_pages": 1,
            "query": query,
            "timestamp": time.time(),
        }
        return text, InlineKeyboardMarkup(buttons)

    total_pages = max(1, (total_items + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(1, min(page, total_pages))

    start_idx = (page - 1) * PAGE_SIZE
    end_idx = min(start_idx + PAGE_SIZE, total_items)
    page_items = items[start_idx:end_idx]

    copy_sessions[user_id] = {
        "folder_id": folder_id,
        "folder_name": folder_name,
        "folder_stack": folder_stack,
        "items": items,
        "page": page,
        "total_pages": total_pages,
        "query": query,
        "timestamp": time.time(),
    }

    header_title = f"Hasil Pencarian: <i>{escape_html(query)}</i>" if query else f"📁 <b>Folder:</b> <b>{escape_html(folder_name)}</b>"

    lines = [
        "📥 <b>Pilih File atau Folder dari Google Drive untuk Di-copy ke Server:</b>",
        header_title,
        f"💾 <b>Tujuan Server:</b> <code>{escape_html(dest_path)}</code>\n",
        f"<b>Daftar Item (Halaman {page}/{total_pages} - Total {total_items}):</b>",
    ]

    for idx, item in enumerate(page_items, start=1):
        icon = "📁" if item["is_dir"] else ("🎬" if item["name"].lower().endswith((".mkv", ".mp4", ".avi", ".ts")) else "📄")
        size_str = f" ({item['formatted_size']})" if not item["is_dir"] else " <i>[Folder]</i>"
        lines.append(f"<b>{idx}.</b> {icon} <code>{escape_html(item['name'])}</code>{size_str}")

    lines.append("\n<i>Tekan tombol angka di bawah atau ketik nomor (1-8) di chat:</i>")
    text = "\n".join(lines)

    # Numbered buttons
    keyboard: List[List[InlineKeyboardButton]] = []
    num_buttons: List[InlineKeyboardButton] = []
    for idx in range(1, len(page_items) + 1):
        num_buttons.append(InlineKeyboardButton(str(idx), callback_data=f"cp_pick:{idx}"))

    for i in range(0, len(num_buttons), 4):
        keyboard.append(num_buttons[i:i + 4])

    # Navigation
    nav_row: List[InlineKeyboardButton] = []
    if page > 1:
        nav_row.append(InlineKeyboardButton("◀️ Prev", callback_data=f"cp_page:{page - 1}"))
    if len(folder_stack) > 1 and not query:
        nav_row.append(InlineKeyboardButton("⬆️ Folder Atas", callback_data="cp_cd_up"))
    if page < total_pages:
        nav_row.append(InlineKeyboardButton("Next ▶️", callback_data=f"cp_page:{page + 1}"))

    if nav_row:
        keyboard.append(nav_row)

    keyboard.append([
        InlineKeyboardButton("🔄 Refresh", callback_data="cp_refresh"),
        InlineKeyboardButton("❌ Batal", callback_data="cp_cancel"),
    ])

    return text, InlineKeyboardMarkup(keyboard)


async def track_copy_progress(client: Client, message: Message, task_id: str, file_name: str, total_bytes: int):
    """Monitors background Google Drive download to server task and updates progress message."""
    last_text = ""
    while True:
        await asyncio.sleep(2.5)
        progress = gdrive_service.get_download_progress(task_id)
        if not progress:
            break

        status = progress.get("status", "downloading")
        pct = float(progress.get("progress_percent", 0.0) or 0.0)
        downloaded = int(progress.get("bytes_downloaded", 0) or 0)
        tot = int(progress.get("total_bytes", total_bytes) or total_bytes)
        speed = float(progress.get("speed_bytes_sec", 0.0) or 0.0)
        dest_path = progress.get("destination_path", "")

        if status == "completed":
            text = (
                "✅ <b>Copy dari Google Drive ke Server Berhasil!</b> 🎉\n\n"
                f"📄 <b>File:</b> <code>{escape_html(file_name)}</code>\n"
                f"📊 <b>Ukuran:</b> {format_bytes(tot)}\n"
                f"📂 <b>Tersimpan di:</b> <code>{escape_html(dest_path)}</code>"
            )
            try:
                await message.edit_text(text)
            except Exception:
                pass
            break

        if status == "failed":
            err = progress.get("error") or "Terjadi kesalahan saat mengunduh."
            text = (
                "❌ <b>Copy dari Google Drive Gagal</b>\n\n"
                f"📄 <b>File:</b> <code>{escape_html(file_name)}</code>\n"
                f"⚠️ <b>Penyebab:</b> <code>{escape_html(str(err))}</code>"
            )
            try:
                await message.edit_text(text)
            except Exception:
                pass
            break

        bar = make_square_progress_bar(pct)
        text = (
            "📥 <b>Meng-copy dari Google Drive ke Server...</b>\n\n"
            f"📄 <b>Item:</b> <code>{escape_html(file_name)}</code>\n"
            f"📊 <b>Progres:</b> {format_bytes(downloaded)} / {format_bytes(tot)} ({pct:.1f}%)\n"
            f"⚡ <b>Kecepatan:</b> {format_speed(speed)}\n"
            f"{bar}\n\n"
            f"⏳ Status: <i>Sedang mendownload ke server...</i>"
        )
        if text != last_text:
            try:
                await message.edit_text(text)
                last_text = text
            except Exception:
                pass


@Client.on_message(filters.command(["copy"]))
@new_task
async def copy_command_handler(client: Client, message: Message):
    """Handles /copy command to browse Google Drive and copy files/folders to server."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await send_message(
            message,
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan perintah ini.",
        )
        return

    cmd_parts = (message.text or "").split(maxsplit=1)
    arg = cmd_parts[1].strip() if len(cmd_parts) > 1 else ""

    session = copy_sessions.get(user_id)
    # If user provided a numeric argument and has an active list, pick directly
    if arg.isdigit() and session and session.get("items"):
        idx = int(arg)
        await process_copy_choice(client, message, user_id, idx, is_callback=False)
        return

    # If argument is text (search query), search Google Drive
    query = arg if arg and not arg.isdigit() else None
    text, keyboard = build_copy_menu_data(user_id, folder_id="root", folder_name="My Drive", query=query)
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


async def process_copy_choice(
    client: Client,
    message: Any,
    user_id: int,
    pick_idx: int,
    is_callback: bool = False,
):
    """Processes user selection in copy menu."""
    session = copy_sessions.get(user_id)
    if not session or not session.get("items"):
        err_text = "⚠️ Sesi copy telah kadaluarsa. Silakan ketik <code>/copy</code> kembali."
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
    dest_path = get_base_save_path()

    # If selected item is a folder: offer to copy entire folder or open it
    if selected["is_dir"]:
        prompt_text = (
            f"📁 <b>Folder Drive Dipilih:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"💾 <b>Tujuan Server:</b> <code>{escape_html(dest_path)}</code>\n\n"
            "Pilih tindakan yang ingin dilakukan:"
        )
        buttons = [
            [InlineKeyboardButton("📥 Copy Seluruh Folder Ini ke Server", callback_data=f"cp_exec:{real_idx}")],
            [InlineKeyboardButton("📂 Buka & Jelajahi Folder Drive", callback_data=f"cp_cd_idx:{real_idx}")],
            [InlineKeyboardButton("🔙 Kembali ke Daftar", callback_data=f"cp_page:{page}")],
        ]
        markup = InlineKeyboardMarkup(buttons)
        if is_callback:
            await message.edit_message_text(prompt_text, reply_markup=markup)
            await message.answer()
        else:
            await message.reply_text(prompt_text, reply_markup=markup)
        return

    # If selected item is a file: initiate download immediately
    if is_callback:
        status_msg = message.message
        await message.answer("Memulai copy...", show_alert=False)
    else:
        status_msg = await message.reply_text("⏳ Menyiapkan copy dari Google Drive...")

    try:
        task_ids = gdrive_service.start_download_to_server(
            items=[{
                "file_id": selected["id"],
                "name": selected["name"],
                "size": selected["size"],
                "mime_type": selected["mime_type"],
            }],
            destination_path=dest_path,
        )
        task_id = task_ids[0]

        init_text = (
            f"🚀 <b>Memulai Copy dari Google Drive ke Server</b>\n\n"
            f"📄 <b>File:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"📊 <b>Ukuran:</b> {format_bytes(selected['size'])}\n"
            f"💾 <b>Tujuan:</b> <code>{escape_html(dest_path)}</code>\n\n"
            f"{make_square_progress_bar(0)}\n\n"
            "⏳ Status: <i>Menghubungi Google Drive...</i>"
        )
        await status_msg.edit_text(init_text)
        asyncio.create_task(
            track_copy_progress(
                client,
                status_msg,
                task_id,
                selected["name"],
                selected["size"],
            )
        )
    except Exception as exc:
        logger.error(f"Failed to start download: {exc}", exc_info=True)
        await status_msg.edit_text(f"❌ <b>Gagal Memulai Copy:</b>\n<code>{escape_html(str(exc))}</code>")


@Client.on_callback_query(filters.regex(r"^cp_pick:(\d+)"))
async def copy_pick_callback(client: Client, callback_query: CallbackQuery):
    """Handles button press selecting an item number in copy menu."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    idx = int(callback_query.matches[0].group(1))
    await process_copy_choice(client, callback_query, user_id, idx, is_callback=True)


@Client.on_callback_query(filters.regex(r"^cp_exec:(\d+)"))
async def copy_exec_folder_callback(client: Client, callback_query: CallbackQuery):
    """Executes copy of an entire directory from Drive to server."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = copy_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    selected = session["items"][real_idx]
    dest_path = get_base_save_path()

    await callback_query.answer("Memulai copy folder...", show_alert=False)
    status_msg = callback_query.message

    try:
        task_ids = gdrive_service.start_download_to_server(
            items=[{
                "file_id": selected["id"],
                "name": selected["name"],
                "size": selected["size"],
                "mime_type": selected["mime_type"],
            }],
            destination_path=dest_path,
        )
        task_id = task_ids[0]

        init_text = (
            f"🚀 <b>Memulai Copy Folder dari Google Drive ke Server</b>\n\n"
            f"📁 <b>Folder:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"💾 <b>Tujuan:</b> <code>{escape_html(dest_path)}</code>\n\n"
            f"{make_square_progress_bar(0)}\n\n"
            "⏳ Status: <i>Menghitung file & memulai download...</i>"
        )
        await status_msg.edit_text(init_text)
        asyncio.create_task(
            track_copy_progress(
                client,
                status_msg,
                task_id,
                selected["name"],
                selected["size"],
            )
        )
    except Exception as exc:
        logger.error(f"Failed to start folder download: {exc}", exc_info=True)
        await status_msg.edit_text(f"❌ <b>Gagal Memulai Copy Folder:</b>\n<code>{escape_html(str(exc))}</code>")


@Client.on_callback_query(filters.regex(r"^cp_cd_idx:(\d+)"))
async def copy_cd_idx_callback(client: Client, callback_query: CallbackQuery):
    """Enters into a Drive subfolder."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = copy_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    selected = session["items"][real_idx]
    folder_stack = list(session.get("folder_stack", [("root", "My Drive")]))
    folder_stack.append((selected["id"], selected["name"]))

    text, keyboard = build_copy_menu_data(
        user_id,
        folder_id=selected["id"],
        folder_name=selected["name"],
        folder_stack=folder_stack,
        page=1,
    )
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^cp_cd_up$"))
async def copy_cd_up_callback(client: Client, callback_query: CallbackQuery):
    """Navigates one level up in Google Drive folders."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = copy_sessions.get(user_id)
    folder_stack = list(session.get("folder_stack", [("root", "My Drive")])) if session else [("root", "My Drive")]

    if len(folder_stack) > 1:
        folder_stack.pop()
    target_id, target_name = folder_stack[-1]

    text, keyboard = build_copy_menu_data(
        user_id,
        folder_id=target_id,
        folder_name=target_name,
        folder_stack=folder_stack,
        page=1,
    )
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^cp_page:(\d+)"))
async def copy_page_callback(client: Client, callback_query: CallbackQuery):
    """Navigates to another page in Drive list."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    page = int(callback_query.matches[0].group(1))
    session = copy_sessions.get(user_id)
    folder_id = session.get("folder_id", "root") if session else "root"
    folder_name = session.get("folder_name", "My Drive") if session else "My Drive"
    folder_stack = session.get("folder_stack") if session else None
    query = session.get("query") if session else None

    text, keyboard = build_copy_menu_data(
        user_id,
        folder_id=folder_id,
        folder_name=folder_name,
        folder_stack=folder_stack,
        page=page,
        query=query,
    )
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^cp_refresh$"))
async def copy_refresh_callback(client: Client, callback_query: CallbackQuery):
    """Refreshes the Google Drive file list."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = copy_sessions.get(user_id)
    folder_id = session.get("folder_id", "root") if session else "root"
    folder_name = session.get("folder_name", "My Drive") if session else "My Drive"
    folder_stack = session.get("folder_stack") if session else None
    page = session.get("page", 1) if session else 1
    query = session.get("query") if session else None

    text, keyboard = build_copy_menu_data(
        user_id,
        folder_id=folder_id,
        folder_name=folder_name,
        folder_stack=folder_stack,
        page=page,
        query=query,
    )
    try:
        await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
        await callback_query.answer("Daftar Drive diperbarui! 🔄")
    except Exception:
        await callback_query.answer("Data sudah paling baru 👍")


@Client.on_callback_query(filters.regex(r"^cp_cancel$"))
async def copy_cancel_callback(client: Client, callback_query: CallbackQuery):
    """Closes and cancels the copy menu."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    copy_sessions.pop(user_id, None)
    await callback_query.edit_message_text("❌ <b>Menu copy dibatalkan.</b>")
    await callback_query.answer("Dibatalkan.")


@Client.on_callback_query(filters.regex(r"^cp_start$"))
async def copy_start_callback(client: Client, callback_query: CallbackQuery):
    """Opens copy menu from start button."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    text, keyboard = build_copy_menu_data(user_id, folder_id="root", folder_name="My Drive", page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()
