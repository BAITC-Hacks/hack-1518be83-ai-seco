import secrets
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./careerquest.db"
    dataset_path: Path = Path("../materials/career_quest_dataset")
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    demo_password: str = "careerquest-demo"
    openai_api_key: str = ""
    openai_model: str = "gpt-6-sol"
    ai_enabled: bool = False
    ai_daily_limit: int = 20
    frontend_dir: Path = Path("frontend/dist")


settings = Settings()
