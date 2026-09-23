"""JWT/password foundation adapted from FastAPI full-stack template (MIT)."""

from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request
from pwdlib import PasswordHash
from sqlmodel import Session

from app.config import settings
from app.db import get_session
from app.models import Account, Document

password_hash = PasswordHash.recommended()


def create_token(username):
    return jwt.encode(
        {"sub": username, "exp": datetime.now(UTC) + timedelta(hours=4)},
        settings.secret_key,
        algorithm="HS256",
    )


def current_account(request: Request, session: Session = Depends(get_session)):
    token = request.cookies.get("quest_session", "")
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=["HS256"], options={"require": ["exp", "sub"]}
        )
        account = session.get(Account, payload["sub"])
    except jwt.PyJWTError:
        account = None
    if not account:
        raise HTTPException(401, "Войдите в демо-аккаунт")
    return account


def hr_account(account=Depends(current_account)):
    if account.role != "hr":
        raise HTTPException(403, "Доступно только HR")
    return account


def team_department(account, session):
    if account.role == "hr":
        return None
    if account.role != "manager":
        raise HTTPException(403, "Обзор команды доступен только HR и руководителю")
    scope = session.get(Document, f"manager_scope:{account.username}")
    if not scope or not scope.payload.get("department"):
        raise HTTPException(403, "Руководителю ещё не назначена область доступа")
    return scope.payload["department"]


def readable_employee(eid, account, session):
    # Authorize before returning profile data. Unknown roles fail closed.
    if account.role not in {"employee", "hr", "manager"}:
        raise HTTPException(403, "Неизвестная роль доступа")
    if account.role == "employee" and account.employee_id != eid:
        raise HTTPException(403, "Можно просматривать только свой профиль")
    doc = session.get(Document, f"employee:{eid}")
    if not doc:
        raise HTTPException(404, "Сотрудник не найден")
    if account.role == "manager" and doc.payload["department"] != team_department(account, session):
        raise HTTPException(403, "Профиль не входит в вашу область доступа")
    return doc
