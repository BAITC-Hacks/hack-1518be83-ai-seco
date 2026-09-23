FROM node:24-slim AS frontend
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend ./backend
COPY alembic.ini ./
COPY --from=frontend /web/dist ./frontend/dist
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH=/app/backend PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home quest
USER quest
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
