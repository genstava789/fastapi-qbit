from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "FastAPI qBittorrent API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000

    # qBittorrent WebUI Settings
    QBIT_HOST: str = "127.0.0.1"
    QBIT_PORT: int = 8089
    QBIT_USERNAME: str = "admin"
    QBIT_PASSWORD: str = ""
    QBIT_VERIFY_WEBUI_CERTIFICATE: bool = False

    # Download directory
    DEFAULT_SAVE_PATH: str = "/home/boxd/Downloads/"

    # Google Drive defaults (optional, actual settings stored in gdrive_settings.json)
    GDRIVE_DEFAULT_UPLOAD_FOLDER_ID: str | None = None
    GDRIVE_DEFAULT_UPLOAD_FOLDER_NAME: str | None = None

    # Prowlarr Search defaults (optional, runtime settings stored in prowlarr_settings.json)
    PROWLARR_URL: str | None = None
    PROWLARR_API_KEY: str | None = None
    PROWLARR_SETTINGS_FILE: str = "prowlarr_settings.json"

    # Telegram Bot Settings (Pyrogram)
    TELEGRAM_BOT_TOKEN: str | None = None
    BOT_TOKEN: str | None = None
    TELEGRAM_API_ID: int | None = None
    TELEGRAM_API: int | None = None
    TELEGRAM_API_HASH: str | None = None
    TELEGRAM_HASH: str | None = None
    TELEGRAM_BOT_NAME: str = "qbit_bot"
    TELEGRAM_AUTHORIZED_USERS: str | None = None
    OWNER_ID: int | str | None = None

    @property
    def qbit_base_url(self) -> str:
        return f"{self.QBIT_HOST}:{self.QBIT_PORT}"


settings = Settings()

