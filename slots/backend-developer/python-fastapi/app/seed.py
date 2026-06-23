"""Deterministic loader for contract/seed/*.json.

No randomisation at load time: ids, prices and seat ordering all come straight
from the fixtures. Passwords are bcrypt-hashed at cost 10, as the fixture meta
requires, so every backend accepts the same seeded credentials.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from typing import Any

import psycopg

from .auth import hash_password
from .config import config
from .migrate import migrate


def _parse_ts(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def seed(database_url: str | None = None, run_migrate: bool = True) -> None:
    url = database_url or config.database_url
    if run_migrate:
        migrate(url)

    seed_json: dict[str, Any] = json.loads(
        (config.seed_dir / "seed.json").read_text(encoding="utf-8")
    )
    seats_json: dict[str, Any] = json.loads(
        (config.seed_dir / "seats.json").read_text(encoding="utf-8")
    )

    password = seed_json["meta"]["password_for_all_users"]
    password_hash = hash_password(password)

    users = seed_json["users"]
    events = seed_json["events"]
    discounts = seed_json["discounts"]
    seats = seats_json["seats"]

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO users (id, email, password_hash, role, name)
                VALUES (%s, %s, %s, %s::user_role, %s)
                """,
                [(u["id"], u["email"], password_hash, u["role"], u["name"]) for u in users],
            )

            cur.executemany(
                """
                INSERT INTO events
                  (id, organizer_id, title, description, venue, starts_at, currency,
                   base_price_cents, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::event_status)
                """,
                [
                    (
                        e["id"],
                        e["organizer_id"],
                        e["title"],
                        e["description"],
                        e["venue"],
                        _parse_ts(e["starts_at"]),
                        e["currency"],
                        int(e["base_price_cents"]),
                        e["status"],
                    )
                    for e in events
                ],
            )

            with cur.copy(
                """
                COPY seats (id, event_id, section, row_label, number, status, price_cents)
                FROM STDIN
                """
            ) as copy:
                for s in seats:
                    copy.write_row(
                        (
                            s["id"],
                            s["event_id"],
                            s["section"],
                            s["row"],
                            int(s["number"]),
                            s["status"],
                            int(s["price_cents"]),
                        )
                    )

            cur.executemany(
                """
                INSERT INTO discounts (code, percent_off, active, stackable, event_id)
                VALUES (%s,%s,%s,%s,%s)
                """,
                [
                    (
                        d["code"],
                        int(d["percent_off"]),
                        bool(d["active"]),
                        bool(d["stackable"]),
                        d["event_id"],
                    )
                    for d in discounts
                ],
            )
        conn.commit()

    print(
        f"Seeded {len(users)} users, {len(events)} events, "
        f"{len(seats)} seats, {len(discounts)} discounts"
    )


def main() -> int:
    seed()
    return 0


if __name__ == "__main__":
    sys.exit(main())
