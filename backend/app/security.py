"""JWT/password foundation adapted from FastAPI full-stack template (MIT)."""

from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request
from pwdlib import PasswordHash
from sqlmodel import Session

from app.config import settings
from app.db import get_session
from app.models import Account

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
