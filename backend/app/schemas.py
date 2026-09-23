from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

Level = Annotated[int, Field(ge=0, le=5)]


class Goal(BaseModel):
    target_role: str
    target_grade: Literal["Junior", "Middle", "Senior", "Lead"]


class Employee(BaseModel):
    employee_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,50}$")
    full_name: str = Field(min_length=1, max_length=150)
    department: str = Field(min_length=1, max_length=100)
    role: str
    grade: Literal["Junior", "Middle", "Senior", "Lead"]
    manager_id: str | None = None
    hire_date: date
    tenure_months: int = Field(ge=0)
    work_format: Literal["office", "hybrid", "remote"]
    preferred_language: Literal["kk", "ru", "en"]
    career_goal: Goal | None = None
    skills: dict[str, Level]
    last_review_date: date
    # Optional extension of the dataset schema; empty means the synthetic rule decides.
    github_login: str | None = Field(default=None, max_length=80)


class HistoryRow(BaseModel):
    record_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    employee_id: str
    event_id: str
    date: date
    due_date: date | None = None
    status: Literal["completed", "in_progress", "dropped", "no_show", "declined", "overdue"]
    completion_pct: int = Field(ge=0, le=100)
    score: float | None = Field(default=None, ge=0, le=100)
    feedback_rating: int | None = Field(default=None, ge=1, le=5)
    assigned_by: str

    @model_validator(mode="before")
    @classmethod
    def blank_optional_values(cls, values):
        return {
            k: None if v == "" and k in {"due_date", "score", "feedback_rating"} else v
            for k, v in values.items()
        }


class Login(BaseModel):
    username: str = Field(max_length=80)
    password: str = Field(max_length=128)


class CompletionRequest(BaseModel):
    event_id: str
    completed_at: date
    evidence: str = Field(min_length=8, max_length=1500)


class ConnectRequest(BaseModel):
    resources: list[str] = Field(min_length=1, max_length=5)
    consent: Literal[True]


class Review(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(min_length=3, max_length=1000)
