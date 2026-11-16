from io import BytesIO
import logging
import re
from pyrogram import Client, filters
from pyrogram.types import Message

from bot import LOGGER
from bot.utils import (
    cmd_exec,
    get_rclone_config_path,
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
    cmd_parts = text.split(maxsplit=1)
    if len(cmd_parts) == 1 or not cmd_parts:
        await send_message(message, "No command to execute was given.")
        return
    cmd = cmd_parts[1]

    # Automatically load rclone.conf if executing rclone
    stripped = cmd.strip()
    rclone_cfg = get_rclone_config_path()
    if (stripped == "rclone" or stripped.startswith("rclone ") or stripped.startswith("rclone\t")) and rclone_cfg:
        if "--config" not in cmd:
            cmd = re.sub(r"^rclone(\s+|$)", f'rclone --config "{rclone_cfg}" ', stripped).strip()
            logger.info(f"Injected rclone config: {rclone_cfg}")

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
