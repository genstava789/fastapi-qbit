"""FastAPI-qBit Telegram Bot Package using Pyrogram."""

import logging
import sys

__version__ = "1.0.0"

LOGGER = logging.getLogger("qbit_bot")
bot_loop = None

# Support both 'bot.module' and 'bot.modules' imports
try:
    from bot import modules
    sys.modules["bot.module"] = modules
    if hasattr(modules, "autosubsync"):
        sys.modules["bot.module.autosubsync"] = modules.autosubsync
    if hasattr(modules, "autosubsync_engine"):
        sys.modules["bot.module.autosubsync_engine"] = modules.autosubsync_engine
except ImportError:
    pass

