#!/usr/bin/env python3
"""Export each dbt model to the result file the grader reads.

    python3 tools/export.py      # -> $RESULTS_DIR (default ./results)

`dbt run` builds relations in the warehouse. The grading interface is a directory
of JSON files (contract/analytics/README.md), so this is the last step of
`make run`.

The ORDER BY is applied here, not in the models, and it is READ FROM THE CONTRACT
rather than written out again. A dbt relation is a table or a view and has no
inherent row order — `SELECT * FROM a_view` may return the view's rows in any
order the planner likes, whatever ORDER BY the view was defined with. Ordering is
therefore a property of the exported answer, and taking it from
contract/analytics/questions.yaml means it cannot drift from the contract that
specifies it.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

import yaml  # a dbt-core dependency; already in the slot's virtualenv

SLOT = pathlib.Path(__file__).resolve().parents[1]
ROOT = SLOT.parents[2]
QUESTIONS = ROOT / "contract" / "analytics" / "questions.yaml"
# Must match `schema:` in the generated profile.
TARGET_SCHEMA = "public"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set — see .env.example")
    return url


def results_dir() -> pathlib.Path:
    raw = os.environ.get("RESULTS_DIR") or str(SLOT / "results")
    path = pathlib.Path(raw)
    if not path.is_absolute():
        path = (SLOT / path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def questions() -> list[dict]:
    doc = yaml.safe_load(QUESTIONS.read_text())
    return doc["questions"]


def export(qid: str, order_by: list[str], url: str) -> tuple[list[dict] | None, str]:
    sql = (
        "SELECT row_to_json(tf_q)::text FROM (\n"
        f"  SELECT * FROM {TARGET_SCHEMA}.{qid}\n"
        f"  ORDER BY {', '.join(order_by)}\n"
        ") AS tf_q;"
    )
    proc = subprocess.run(
        ["psql", url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=sql, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        return None, (proc.stdout + proc.stderr).strip()
    rows = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    return rows, ""


def main() -> None:
    url = database_url()
    out_dir = results_dir()
    # Stale answers are worse than missing ones: the grader would score a result
    # file for a model this project no longer builds.
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    failures = 0
    for q in questions():
        qid = q["id"]
        rows, err = export(qid, q["order_by"], url)
        if rows is None:
            failures += 1
            print(f"  {qid}: FAILED\n{err}", file=sys.stderr)
            continue
        (out_dir / f"{qid}.json").write_text(json.dumps(rows, indent=2) + "\n")
        print(f"  {qid}: {len(rows)} rows")

    print(f"exported {len(questions()) - failures} answers to {out_dir}")
    if failures:
        sys.exit(f"{failures} model(s) could not be exported — did `dbt run` succeed?")


if __name__ == "__main__":
    main()
