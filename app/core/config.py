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
    QBIT_PORT: int = 8080
    QBIT_USERNAME: str = "admin"
    QBIT_PASSWORD: str = ""
    QBIT_VERIFY_WEBUI_CERTIFICATE: bool = False

    # Download directory
    DEFAULT_SAVE_PATH: str = "/home/boxd/Downloads/"

    @property
    def qbit_base_url(self) -> str:
        return f"{self.QBIT_HOST}:{self.QBIT_PORT}"


settings = Settings()

