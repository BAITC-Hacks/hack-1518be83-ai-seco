"""Initial hackathon schema."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    op.create_table(
        "document",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_document_kind", "document", ["kind"])
    op.create_table(
        "account",
        sa.Column("username", sa.String(), primary_key=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("employee_id", sa.String()),
    )
    op.create_table(
        "completion",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("employee_id", sa.String(), nullable=False),
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("occurrence", sa.String(), nullable=False),
        sa.Column("completed_at", sa.String(), nullable=False),
        sa.Column("evidence", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("requested_at", sa.String(), nullable=False),
        sa.Column("reviewed_at", sa.String()),
        sa.Column("reviewer", sa.String()),
        sa.Column("review_note", sa.String(), nullable=False),
        sa.UniqueConstraint("employee_id", "event_id", "occurrence"),
    )
    op.create_index("ix_completion_employee_id", "completion", ["employee_id"])
    op.create_table(
        "audit",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("actor", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "aicache",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_table(
        "aibudget",
        sa.Column("day", sa.String(), primary_key=True),
        sa.Column("calls", sa.Integer(), nullable=False),
    )


def downgrade():
    for table in ("aibudget", "aicache", "audit", "completion", "account", "document"):
        op.drop_table(table)
