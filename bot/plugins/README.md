# Folder Plugins (Ekstensi Fitur Tambahan)

Folder ini disediakan untuk menambahkan fitur-fitur baru ke bot Telegram secara modular di masa mendatang.

## Cara Menambahkan Plugin Baru:

1. Buat file Python baru di dalam folder ini, misalnya `add_torrent.py` atau `search.py`.
2. Gunakan decorator standar Pyrogram `@Client.on_message` atau `@Client.on_callback_query`.
3. Pyrogram akan secara otomatis menemukan dan memuat handler baru tanpa perlu mengubah file `__main__.py`.

### Contoh Plugin (`bot/plugins/contoh.py`):

```python
from pyrogram import Client, filters
from pyrogram.types import Message

@Client.on_message(filters.command(["ping"]))
async def ping_handler(client: Client, message: Message):
    await message.reply_text("🏓 Pong! Bot aktif dan merespons dengan cepat.")
```
