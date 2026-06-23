"""Apply contract/schema.sql verbatim.

The schema file is the canonical DDL; nothing here invents tables, columns or
indexes. ``public`` is dropped first so migrate+seed is deterministic and
repeatable.
"""

from __future__ import annotations

import sys

import psycopg

from .config import config


def migrate(database_url: str | None = None) -> None:
    url = database_url or config.database_url
    sql = config.schema_sql.read_text(encoding="utf-8")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            """
            DROP SCHEMA public CASCADE;
            CREATE SCHEMA public;
            GRANT ALL ON SCHEMA public TO public;
            """
        )
        conn.execute(sql)
    print(f"Migrated schema from {config.schema_sql}")


def main() -> int:
    migrate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
