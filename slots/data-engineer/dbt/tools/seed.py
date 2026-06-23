#!/usr/bin/env python3
"""Load the contract seed and the analytics fixture into DATABASE_URL.

    python3 tools/seed.py                 # migrate, then seed (what `make seed` runs)
    python3 tools/seed.py --schema-only   # just the schema (what `make migrate` runs)

Uses psql rather than a database driver so that `make migrate` and `make seed` work
before the virtualenv exists. Each slot in this repo owns its own loader; this one
is deliberately the same shape as slots/data-engineer/sql-analytics/tools/seed.py.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys

SLOT = pathlib.Path(__file__).resolve().parents[1]
ROOT = SLOT.parents[2]
CONTRACT = ROOT / "contract"

# bcrypt(cost 10) of contract/seed/seed.json's `password_for_all_users`. This slot
# never authenticates anybody, so recomputing a constant is not worth a dependency.
PASSWORD_HASH = "$2a$10$5gKhXd.DhjoAuNdHjHj5/e4kehz/iG8p2DYObWRJysodTWtGybzvu"


def lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set — see .env.example")
    return url


def psql(sql: str, url: str) -> None:
    proc = subprocess.run(
        ["psql", url, "-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=sql, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        sys.exit(f"psql failed (exit {proc.returncode})")


def migrate_sql() -> str:
    return (
        "DROP SCHEMA public CASCADE;\n"
        "CREATE SCHEMA public;\n"
        "GRANT ALL ON SCHEMA public TO public;\n"
        + (CONTRACT / "schema.sql").read_text()
    )


def seed_sql() -> str:
    seed = json.loads((CONTRACT / "seed" / "seed.json").read_text())
    seats = json.loads((CONTRACT / "seed" / "seats.json").read_text())["seats"]

    out: list[str] = ["BEGIN;"]
    for u in seed["users"]:
        out.append(
            "INSERT INTO users (id, email, password_hash, role, name) VALUES ("
            f"{lit(u['id'])}, {lit(u['email'])}, {lit(PASSWORD_HASH)},"
            f" {lit(u['role'])}, {lit(u['name'])});"
        )
    for e in seed["events"]:
        out.append(
            "INSERT INTO events (id, organizer_id, title, description, venue, starts_at,"
            " currency, base_price_cents, status) VALUES ("
            f"{lit(e['id'])}, {lit(e['organizer_id'])}, {lit(e['title'])},"
            f" {lit(e['description'])}, {lit(e['venue'])}, {lit(e['starts_at'])},"
            f" {lit(e['currency'])}, {lit(e['base_price_cents'])}, {lit(e['status'])});"
        )
    for s in seats:
        out.append(
            "INSERT INTO seats (id, event_id, section, row_label, number, status, price_cents)"
            f" VALUES ({lit(s['id'])}, {lit(s['event_id'])}, {lit(s['section'])},"
            f" {lit(s['row'])}, {lit(s['number'])}, {lit(s['status'])},"
            f" {lit(s['price_cents'])});"
        )
    for d in seed["discounts"]:
        out.append(
            "INSERT INTO discounts (code, percent_off, active, stackable, event_id) VALUES ("
            f"{lit(d['code'])}, {lit(d['percent_off'])}, {lit(d['active'])},"
            f" {lit(d['stackable'])}, {lit(d['event_id'])});"
        )
    out.append("COMMIT;")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema-only", action="store_true",
                    help="drop and recreate the schema and stop there")
    args = ap.parse_args()

    url = database_url()
    psql(migrate_sql(), url)
    print("migrated schema from contract/schema.sql")
    if args.schema_only:
        return

    psql(seed_sql(), url)
    print("loaded contract/seed (users, events, seats, discounts)")
    psql((CONTRACT / "analytics" / "fixture.sql").read_text(), url)
    print("loaded contract/analytics/fixture.sql (holds, orders, outbox history)")


if __name__ == "__main__":
    main()
