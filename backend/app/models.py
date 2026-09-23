from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def now() -> str:
    return datetime.now(UTC).isoformat()


class Document(SQLModel, table=True):
    id: str = Field(primary_key=True)
    kind: str = Field(index=True)
    payload: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))


class Account(SQLModel, table=True):
    username: str = Field(primary_key=True)
    password_hash: str
    role: str
    employee_id: str | None = None


class Completion(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("employee_id", "event_id", "occurrence"),)
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    employee_id: str = Field(index=True)
    event_id: str
    occurrence: str
    completed_at: str
    evidence: str
    status: str = "pending"
    requested_at: str = Field(default_factory=now)
    reviewed_at: str | None = None
    reviewer: str | None = None
    review_note: str = ""


class Connection(SQLModel, table=True):
    """Demo GitHub/Jira access an employee granted with explicit consent."""

    __table_args__ = (UniqueConstraint("employee_id", "source"),)
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    employee_id: str = Field(index=True)
    source: str
    resources: list[str] = Field(sa_column=Column(JSON, nullable=False))
    consent_at: str = Field(default_factory=now)
    synced_at: str = Field(default_factory=now)


class Audit(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    actor: str
    action: str
    target: str
    created_at: str = Field(default_factory=now)


class AICache(SQLModel, table=True):
    id: str = Field(primary_key=True)
    payload: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))


class AIBudget(SQLModel, table=True):
    day: str = Field(primary_key=True)
    calls: int = 0
