import asyncio
import logging
import os
import shutil
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
    new_task,
)

logger = LOGGER or logging.getLogger(__name__)

# User sessions: user_id -> dict
delete_sessions: Dict[int, Dict[str, Any]] = {}
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


def is_safe_path(target_path: str) -> bool:
    """Checks whether the target path is strictly inside the base download directory and not the root itself."""
    base_root = get_base_save_path()
    real = os.path.realpath(target_path)
    try:
        return os.path.commonpath([base_root, real]) == base_root and real != base_root
    except ValueError:
        return False


def calculate_dir_size(dir_path: str) -> int:
    """Calculates total size of all files in a directory recursively."""
    total = 0
    try:
        for root, _, files in os.walk(dir_path):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    except Exception:
        pass
    return total


def scan_local_items(directory: str, query: Optional[str] = None) -> List[Dict[str, Any]]:
    """Scans files and subdirectories in the specified directory, optionally filtered by query."""
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

    clean_query = query.strip().lower() if query else None

    try:
        with os.scandir(real_dir) as entries:
            for entry in entries:
                try:
                    name = entry.name
                    if clean_query and clean_query not in name.lower():
                        continue

                    is_dir = entry.is_dir(follow_symlinks=True)
                    size = 0 if is_dir else entry.stat().st_size
                    items.append({
                        "name": name,
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


def build_delete_menu_data(
    user_id: int,
    current_dir: Optional[str] = None,
    page: int = 1,
    query: Optional[str] = None,
) -> tuple[str, Optional[InlineKeyboardMarkup]]:
    """Builds text and inline keyboard markup for local server file deletion."""
    base_root = get_base_save_path()
    if not current_dir:
        current_dir = base_root
    current_dir = os.path.realpath(current_dir)
    try:
        if os.path.commonpath([base_root, current_dir]) != base_root:
            current_dir = base_root
    except ValueError:
        current_dir = base_root

    items = scan_local_items(current_dir, query=query)
    total_items = len(items)

    # Relative path for display
    rel_path = os.path.relpath(current_dir, base_root)
    display_path = "/" if rel_path == "." else f"/{rel_path.replace(os.sep, '/')}"

    if total_items == 0:
        if query:
            empty_msg = f"<i>Tidak ditemukan file atau folder yang cocok dengan:</i> <code>{escape_html(query)}</code>"
        else:
            empty_msg = "<i>Folder server ini kosong (tidak ada file atau folder yang dapat dihapus).</i>"

        text = (
            "🗑️ <b>Hapus File/Folder Lokal Server</b>\n\n"
            f"📂 <b>Folder Server:</b> <code>{escape_html(display_path)}</code>\n\n"
            f"{empty_msg}"
        )
        buttons = []
        if current_dir != base_root and not query:
            buttons.append([InlineKeyboardButton("⬆️ Naik Folder", callback_data="del_cd_up")])
        buttons.append([
            InlineKeyboardButton("🔄 Refresh", callback_data="del_refresh"),
            InlineKeyboardButton("❌ Tutup", callback_data="del_cancel"),
        ])
        delete_sessions[user_id] = {
            "current_dir": current_dir,
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

    delete_sessions[user_id] = {
        "current_dir": current_dir,
        "items": items,
        "page": page,
        "total_pages": total_pages,
        "query": query,
        "timestamp": time.time(),
    }

    header_query = f"🔍 <b>Filter:</b> <code>{escape_html(query)}</code>\n" if query else ""

    lines = [
        "🗑️ <b>Pilih File atau Folder yang Ingin Dihapus dari Server:</b>",
        f"📂 <b>Folder Server:</b> <code>{escape_html(display_path)}</code>",
        header_query,
        f"<b>Daftar Item (Halaman {page}/{total_pages} - Total {total_items}):</b>",
    ]

    for idx, item in enumerate(page_items, start=1):
        icon = "📁" if item["is_dir"] else ("🎬" if item["name"].lower().endswith((".mkv", ".mp4", ".avi", ".ts")) else "📄")
        size_str = f" ({item['formatted_size']})" if not item["is_dir"] else " <i>[Folder]</i>"
        lines.append(f"<b>{idx}.</b> {icon} <code>{escape_html(item['name'])}</code>{size_str}")

    lines.append("\n<i>Tekan tombol angka di bawah atau ketik nomor (1-8) di chat:</i>")
    text = "\n".join(lines)

    # Number buttons
    keyboard: List[List[InlineKeyboardButton]] = []
    num_buttons: List[InlineKeyboardButton] = []
    for idx in range(1, len(page_items) + 1):
        num_buttons.append(InlineKeyboardButton(str(idx), callback_data=f"del_pick:{idx}"))

    for i in range(0, len(num_buttons), 4):
        keyboard.append(num_buttons[i:i + 4])

    # Navigation buttons
    nav_row: List[InlineKeyboardButton] = []
    if page > 1:
        nav_row.append(InlineKeyboardButton("◀️ Prev", callback_data=f"del_page:{page - 1}"))
    if current_dir != base_root and not query:
        nav_row.append(InlineKeyboardButton("⬆️ Naik", callback_data="del_cd_up"))
    if page < total_pages:
        nav_row.append(InlineKeyboardButton("Next ▶️", callback_data=f"del_page:{page + 1}"))

    if nav_row:
        keyboard.append(nav_row)

    keyboard.append([
        InlineKeyboardButton("🔄 Refresh", callback_data="del_refresh"),
        InlineKeyboardButton("❌ Batal", callback_data="del_cancel"),
    ])

    return text, InlineKeyboardMarkup(keyboard)


@Client.on_message(filters.command(["delete"]))
@new_task
async def delete_command_handler(client: Client, message: Message):
    """Handles /delete command with optional search query or item number."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await message.reply_text(
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan bot ini."
        )
        return

    cmd_parts = (message.text or "").split(maxsplit=1)
    arg = cmd_parts[1].strip() if len(cmd_parts) > 1 else ""

    session = delete_sessions.get(user_id)
    # If user provided a numeric argument and has an active session, process choice directly
    if arg.isdigit() and session and session.get("items"):
        idx = int(arg)
        await process_delete_choice(client, message, user_id, idx, is_callback=False)
        return

    # If user provided text argument, treat as search query
    query = arg if arg and not arg.isdigit() else None
    text, keyboard = build_delete_menu_data(user_id, current_dir=None, page=1, query=query)
    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)


async def process_delete_choice(
    client: Client,
    message: Any,
    user_id: int,
    pick_idx: int,
    is_callback: bool = False,
):
    """Processes user selection for deletion."""
    session = delete_sessions.get(user_id)
    if not session or not session.get("items"):
        err_text = "⚠️ Sesi hapus telah kadaluarsa. Silakan ketik <code>/delete</code> kembali."
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
    base_root = get_base_save_path()
    rel_path = os.path.relpath(selected["path"], base_root)
    display_item_path = f"/{rel_path.replace(os.sep, '/')}"

    # If selected item is a folder: offer to delete entire folder or browse inside it
    if selected["is_dir"]:
        prompt_text = (
            f"📁 <b>Folder Dipilih:</b> <code>{escape_html(selected['name'])}</code>\n"
            f"📍 <b>Path Server:</b> <code>{escape_html(display_item_path)}</code>\n\n"
            "Pilih tindakan yang ingin dilakukan:"
        )
        buttons = [
            [InlineKeyboardButton("🗑️ Hapus Seluruh Folder Ini", callback_data=f"del_confirm:{real_idx}")],
            [InlineKeyboardButton("📂 Buka & Jelajahi Folder", callback_data=f"del_cd_idx:{real_idx}")],
            [InlineKeyboardButton("🔙 Kembali ke Daftar", callback_data=f"del_page:{page}")],
        ]
        markup = InlineKeyboardMarkup(buttons)
        if is_callback:
            await message.edit_message_text(prompt_text, reply_markup=markup)
            await message.answer()
        else:
            await message.reply_text(prompt_text, reply_markup=markup)
        return

    # If selected item is a file: show confirmation dialog before deleting
    prompt_text = (
        "⚠️ <b>Konfirmasi Hapus File Lokal</b>\n\n"
        f"📄 <b>File:</b> <code>{escape_html(selected['name'])}</code>\n"
        f"📊 <b>Ukuran:</b> {format_bytes(selected['size'])}\n"
        f"📍 <b>Lokasi:</b> <code>{escape_html(display_item_path)}</code>\n\n"
        "<i>Apakah Anda yakin ingin menghapus file ini secara permanen dari server? "
        "Tindakan ini tidak dapat dibatalkan.</i>"
    )
    buttons = [
        [InlineKeyboardButton("🗑️ Ya, Hapus File Sekarang", callback_data=f"del_exec:{real_idx}")],
        [InlineKeyboardButton("❌ Batal", callback_data=f"del_page:{page}")],
    ]
    markup = InlineKeyboardMarkup(buttons)
    if is_callback:
        await message.edit_message_text(prompt_text, reply_markup=markup)
        await message.answer()
    else:
        await message.reply_text(prompt_text, reply_markup=markup)


@Client.on_callback_query(filters.regex(r"^del_start$"))
async def delete_start_callback(client: Client, callback_query: CallbackQuery):
    """Opens root delete menu from button."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    text, keyboard = build_delete_menu_data(user_id, current_dir=None, page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^del_pick:(\d+)$"))
async def delete_pick_callback(client: Client, callback_query: CallbackQuery):
    """Handles number button click in delete menu."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    pick_idx = int(callback_query.matches[0].group(1))
    await process_delete_choice(client, callback_query, user_id, pick_idx, is_callback=True)


@Client.on_callback_query(filters.regex(r"^del_confirm:(\d+)$"))
async def delete_confirm_folder_callback(client: Client, callback_query: CallbackQuery):
    """Shows explicit confirmation dialog before recursively deleting a folder."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = delete_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    selected = session["items"][real_idx]
    base_root = get_base_save_path()
    rel_path = os.path.relpath(selected["path"], base_root)
    display_item_path = f"/{rel_path.replace(os.sep, '/')}"

    dir_size = calculate_dir_size(selected["path"])
    prompt_text = (
        "⚠️ <b>Konfirmasi Hapus Folder Lokal</b>\n\n"
        f"📁 <b>Folder:</b> <code>{escape_html(selected['name'])}</code>\n"
        f"📊 <b>Total Ukuran:</b> {format_bytes(dir_size)}\n"
        f"📍 <b>Lokasi:</b> <code>{escape_html(display_item_path)}</code>\n\n"
        "🚨 <b>PERINGATAN:</b> Seluruh file dan subfolder di dalam folder ini akan dihapus "
        "secaran permanen dari server!\n\n"
        "<i>Apakah Anda benar-benar yakin? Tindakan ini tidak dapat dibatalkan.</i>"
    )
    buttons = [
        [InlineKeyboardButton("🚨 Ya, Hapus Seluruh Folder!", callback_data=f"del_exec:{real_idx}")],
        [InlineKeyboardButton("❌ Batal", callback_data=f"del_page:{session.get('page', 1)}")],
    ]
    await callback_query.edit_message_text(prompt_text, reply_markup=InlineKeyboardMarkup(buttons))
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^del_exec:(\d+)$"))
async def delete_exec_callback(client: Client, callback_query: CallbackQuery):
    """Executes the permanent deletion of a file or folder."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = delete_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    selected = session["items"][real_idx]
    target_path = selected["path"]
    name = selected["name"]
    is_dir = selected["is_dir"]
    base_root = get_base_save_path()

    # Safety check: path traversal prevention
    if not is_safe_path(target_path):
        await callback_query.answer("⛔ Tindakan terlarang: path di luar direktori downloads.", show_alert=True)
        return

    if not os.path.exists(target_path):
        await callback_query.answer("⚠️ File atau folder sudah tidak ditemukan.", show_alert=True)
        return

    try:
        # Calculate size freed before deletion
        size_freed = calculate_dir_size(target_path) if is_dir else os.path.getsize(target_path)

        if is_dir:
            shutil.rmtree(target_path)
            logger.info(f"User {user_id} deleted directory: {target_path}")
        else:
            os.remove(target_path)
            logger.info(f"User {user_id} deleted file: {target_path}")

        parent_dir = os.path.dirname(target_path)
        rel_parent = os.path.relpath(parent_dir, base_root)
        display_parent = "/" if rel_parent == "." else f"/{rel_parent.replace(os.sep, '/')}"

        success_text = (
            "✅ <b>Berhasil Dihapus dari Server!</b> 🗑️\n\n"
            f"{'📁' if is_dir else '📄'} <b>Item:</b> <code>{escape_html(name)}</code>\n"
            f"📊 <b>Ruang Dibebaskan:</b> {format_bytes(size_freed)}\n"
            f"📂 <b>Lokasi:</b> <code>{escape_html(display_parent)}</code>"
        )
        buttons = [
            [InlineKeyboardButton("📂 Kembali ke Daftar File", callback_data="del_refresh")],
            [InlineKeyboardButton("❌ Tutup", callback_data="del_cancel")],
        ]
        await callback_query.edit_message_text(
            success_text,
            reply_markup=InlineKeyboardMarkup(buttons),
        )
        await callback_query.answer("Item berhasil dihapus! 🗑️")
    except PermissionError as p_err:
        logger.error(f"Permission error deleting {target_path}: {p_err}")
        await callback_query.edit_message_text(
            f"❌ <b>Gagal Menghapus (Permission Denied):</b>\n<code>{escape_html(str(p_err))}</code>",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Kembali", callback_data="del_refresh")]]),
        )
    except Exception as exc:
        logger.error(f"Error deleting {target_path}: {exc}", exc_info=True)
        await callback_query.edit_message_text(
            f"❌ <b>Gagal Menghapus:</b>\n<code>{escape_html(str(exc))}</code>",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Kembali", callback_data="del_refresh")]]),
        )


@Client.on_callback_query(filters.regex(r"^del_cd_idx:(\d+)$"))
async def delete_cd_idx_callback(client: Client, callback_query: CallbackQuery):
    """Enters into a subdirectory."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    real_idx = int(callback_query.matches[0].group(1))
    session = delete_sessions.get(user_id)
    if not session or not session.get("items") or real_idx >= len(session["items"]):
        await callback_query.answer("⚠️ Sesi kadaluarsa.", show_alert=True)
        return

    target_dir = session["items"][real_idx]["path"]
    text, keyboard = build_delete_menu_data(user_id, current_dir=target_dir, page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^del_cd_up$"))
async def delete_cd_up_callback(client: Client, callback_query: CallbackQuery):
    """Navigates one level up to the parent directory."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = delete_sessions.get(user_id)
    base_root = get_base_save_path()
    current_dir = session.get("current_dir", base_root) if session else base_root
    parent_dir = os.path.dirname(current_dir)

    try:
        if os.path.commonpath([base_root, parent_dir]) != base_root:
            parent_dir = base_root
    except ValueError:
        parent_dir = base_root

    text, keyboard = build_delete_menu_data(user_id, current_dir=parent_dir, page=1)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^del_page:(\d+)$"))
async def delete_page_callback(client: Client, callback_query: CallbackQuery):
    """Navigates to another page."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    page = int(callback_query.matches[0].group(1))
    session = delete_sessions.get(user_id)
    current_dir = session.get("current_dir") if session else None
    query = session.get("query") if session else None

    text, keyboard = build_delete_menu_data(user_id, current_dir=current_dir, page=page, query=query)
    await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
    await callback_query.answer()


@Client.on_callback_query(filters.regex(r"^del_refresh$"))
async def delete_refresh_callback(client: Client, callback_query: CallbackQuery):
    """Refreshes the file list."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    session = delete_sessions.get(user_id)
    current_dir = session.get("current_dir") if session else None
    page = session.get("page", 1) if session else 1
    query = session.get("query") if session else None

    text, keyboard = build_delete_menu_data(user_id, current_dir=current_dir, page=page, query=query)
    try:
        await callback_query.edit_message_text(text, reply_markup=keyboard, disable_web_page_preview=True)
        await callback_query.answer("Daftar file diperbarui! 🔄")
    except Exception:
        await callback_query.answer("Data sudah paling baru 👍")


@Client.on_callback_query(filters.regex(r"^del_cancel$"))
async def delete_cancel_callback(client: Client, callback_query: CallbackQuery):
    """Closes the delete menu."""
    user_id = callback_query.from_user.id if callback_query.from_user else 0
    if not is_user_authorized(user_id):
        await callback_query.answer("⛔ Akses ditolak.", show_alert=True)
        return

    delete_sessions.pop(user_id, None)
    try:
        await callback_query.message.delete()
    except Exception:
        await callback_query.edit_message_text("❌ <i>Menu hapus file telah ditutup.</i>")
    await callback_query.answer("Dibatalkan.")
