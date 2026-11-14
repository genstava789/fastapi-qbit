from pyrogram import Client, filters
from pyrogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from bot.utils import is_user_authorized


@Client.on_message(filters.command(["start", "help"]))
async def start_help_command_handler(client: Client, message: Message):
    """Handles /start and /help command."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await message.reply_text(
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan bot ini."
        )
        return

    first_name = message.from_user.first_name if message.from_user else "Pengguna"

    text = (
        f"👋 <b>Halo, {first_name}!</b>\n\n"
        "Selamat datang di <b>FastAPI-qBit Telegram Bot</b>.\n"
        "Bot ini terhubung langsung ke daemon qBittorrent Anda untuk memantau aktivitas unduhan dan unggahan secara real-time.\n\n"
        "📌 <b>Perintah yang Tersedia:</b>\n"
        "• <code>/status</code> - Pantau kecepatan transfer, progres torrent yang sedang aktif (download/upload), dan storage.\n"
        "• <code>/shell &lt;cmd&gt;</code> - Menjalankan perintah Linux shell di server (contoh: <code>/shell ls</code>).\n"
        "• <code>/help</code> - Menampilkan pesan panduan ini.\n\n"
        "Tekan tombol di bawah untuk melihat status qBittorrent saat ini:"
    )

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📊 Cek Status Torrent", callback_data="status_page:1")],
    ])

    await message.reply_text(text, reply_markup=keyboard, disable_web_page_preview=True)
