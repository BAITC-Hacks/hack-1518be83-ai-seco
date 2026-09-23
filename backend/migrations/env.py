from alembic import context
from app import models  # noqa: F401
from app.db import engine
from sqlmodel import SQLModel

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=SQLModel.metadata)
    with context.begin_transaction():
        context.run_migrations()
