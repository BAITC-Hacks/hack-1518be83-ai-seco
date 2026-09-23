"""Demo GitHub/Jira connections granted by employees."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade():
    op.create_table(
        "connection",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("employee_id", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
        sa.Column("consent_at", sa.String(), nullable=False),
        sa.Column("synced_at", sa.String(), nullable=False),
        sa.UniqueConstraint("employee_id", "source"),
    )
    op.create_index("ix_connection_employee_id", "connection", ["employee_id"])


def downgrade():
    op.drop_table("connection")
