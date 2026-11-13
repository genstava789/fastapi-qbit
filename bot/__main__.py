import logging
import os
import sys

# Ensure repository root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv
from pyrogram import Client, enums

# Load .env file if available
load_dotenv()

from app.core.config import settings
from app.services.qbit_service import qbit_service

# Configure clean logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("qbit_bot")


def create_bot() -> Client:
    """Validates configuration and creates the Pyrogram Client."""
    token = (
        settings.TELEGRAM_BOT_TOKEN
        or settings.BOT_TOKEN
        or os.getenv("TELEGRAM_BOT_TOKEN")
        or os.getenv("BOT_TOKEN")
    )
    api_id = (
        settings.TELEGRAM_API_ID
        or settings.TELEGRAM_API
        or os.getenv("TELEGRAM_API_ID")
        or os.getenv("TELEGRAM_API")
        or os.getenv("API_ID")
    )
    api_hash = (
        settings.TELEGRAM_API_HASH
        or settings.TELEGRAM_HASH
        or os.getenv("TELEGRAM_API_HASH")
        or os.getenv("TELEGRAM_HASH")
        or os.getenv("API_HASH")
    )

    if not token:
        logger.error("TELEGRAM_BOT_TOKEN is missing in environment or .env file.")
        print("\n" + "=" * 60)
        print("❌ [ERROR] TELEGRAM_BOT_TOKEN is not configured!")
        print("=" * 60)
        print("Langkah mudah mengaktifkan Telegram Bot:")
        print("1. Buat bot baru di Telegram via @BotFather untuk mendapatkan BOT_TOKEN.")
        print("2. Dapatkan API_ID dan API_HASH di https://my.telegram.org (opsional atau gunakan akun Anda).")
        print("3. Isi variabel berikut di file .env:")
        print('   TELEGRAM_BOT_TOKEN="your_token_here"')
        print('   TELEGRAM_API_ID="12345678"')
        print('   TELEGRAM_API_HASH="your_api_hash"')
        print("=" * 60 + "\n")
        sys.exit(1)

    if not api_id or not api_hash:
        logger.error("TELEGRAM_API_ID or TELEGRAM_API_HASH is missing.")
        print("\n" + "=" * 60)
        print("❌ [ERROR] TELEGRAM_API_ID atau TELEGRAM_API_HASH belum diatur!")
        print("=" * 60)
        print("Pyrogram memerlukan API_ID dan API_HASH dari https://my.telegram.org.")
        print("Tambahkan ke file .env:")
        print('   TELEGRAM_API_ID="12345678"')
        print('   TELEGRAM_API_HASH="your_hash_here"')
        print("=" * 60 + "\n")
        sys.exit(1)

    try:
        api_id_int = int(api_id)
    except ValueError:
        logger.error(f"TELEGRAM_API_ID must be an integer, got: {api_id}")
        sys.exit(1)

    client = Client(
        name=settings.TELEGRAM_BOT_NAME or "qbit_bot",
        api_id=api_id_int,
        api_hash=str(api_hash),
        bot_token=str(token),
        plugins=dict(root="bot"),
        parse_mode=enums.ParseMode.HTML,
        workdir=".",
    )
    return client


def main():
    """Main entrypoint to run the Telegram Bot."""
    print("=" * 60)
    print("🚀 Memulai FastAPI-qBit Telegram Bot (Pyrogram)...")
    print("=" * 60)

    # 1. Validate environment configuration and prepare Pyrogram client
    app = create_bot()

    # 2. Test connection to qBittorrent daemon
    connected, version = qbit_service.check_connection()
    if connected:
        logger.info(f"Terhubung ke qBittorrent daemon: Version {version}")
    else:
        logger.warning(
            f"Tidak dapat terhubung ke qBittorrent di {settings.qbit_base_url}. "
            "Pastikan service qBittorrent berjalan."
        )

    logger.info("Bot siap menerima perintah (/status, /start, dll)...")
    app.run()


if __name__ == "__main__":
    main()
