from io import BytesIO
import logging
from pyrogram import Client, filters
from pyrogram.types import Message

from bot import LOGGER
from bot.utils import (
    cmd_exec,
    is_user_authorized,
    new_task,
    send_file,
    send_message,
)

logger = LOGGER or logging.getLogger(__name__)


@Client.on_message(filters.command(["shell", "sh"]))
@new_task
async def run_shell(_, message: Message):
    """Executes a shell command on the host/container and replies with stdout and stderr."""
    user_id = message.from_user.id if message.from_user else 0
    if not is_user_authorized(user_id):
        await send_message(
            message,
            "⛔ <b>Akses Ditolak</b>\nAnda tidak memiliki izin untuk menggunakan perintah ini.",
        )
        return

    text = message.text or message.caption or ""
    cmd = text.split(maxsplit=1)
    if len(cmd) == 1 or not cmd:
        await send_message(message, "No command to execute was given.")
        return
    cmd = cmd[1]
    stdout, stderr, _ = await cmd_exec(cmd, shell=True)
    reply = ""
    if len(stdout) != 0:
        reply += f"*Stdout*\n<code>{stdout}</code>\n"
        logger.info(f"Shell - {cmd} - {stdout}")
    if len(stderr) != 0:
        reply += f"*Stderr*\n<code>{stderr}</code>"
        logger.error(f"Shell - {cmd} - {stderr}")
    if len(reply) > 3000:
        with BytesIO(str.encode(reply)) as out_file:
            out_file.name = "shell_output.txt"
            await send_file(message, out_file)
    elif len(reply) != 0:
        await send_message(message, reply)
    else:
        await send_message(message, "No Reply")
