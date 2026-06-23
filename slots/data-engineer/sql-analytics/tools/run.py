#!/usr/bin/env python3
"""Execute every query in queries/ and write one result file per question id.

    python3 tools/run.py            # -> $RESULTS_DIR (default ./results)

The result files are the only thing the grader looks at. The interface is defined
in contract/analytics/README.md: `<question_id>.json`, a JSON array of row
objects, in the order the query returned them.

Row order is preserved by serialising one row per line with row_to_json and
reassembling the array here. `json_agg` would have been shorter and would have
quietly dropped the ORDER BY, since the order in which an aggregate consumes its
input is not guaranteed.

Stale results are deleted before anything runs. A result file left over from a
previous run is worse than a missing one: the suite would grade yesterday's
answer to a question the implementation no longer answers.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

SLOT = pathlib.Path(__file__).resolve().parents[1]
QUERIES = SLOT / "queries"


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


def run_query(sql_path: pathlib.Path, url: str) -> tuple[list[dict] | None, str]:
    body = sql_path.read_text().strip()
    # A trailing semicolon would terminate the statement we are wrapping it in.
    while body.endswith(";"):
        body = body[:-1].rstrip()
    wrapped = (
        "SELECT row_to_json(tf_q)::text FROM (\n"
        f"{body}\n"
        ") AS tf_q;"
    )
    proc = subprocess.run(
        # -A unaligned, -t tuples only: exactly one JSON object per line.
        ["psql", url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=wrapped, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        return None, (proc.stdout + proc.stderr).strip()
    rows: list[dict] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows, ""


def main() -> None:
    url = database_url()
    out_dir = results_dir()
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    sql_files = sorted(QUERIES.glob("*.sql"))
    if not sql_files:
        sys.exit(f"no queries found in {QUERIES}")

    failures = 0
    for sql_path in sql_files:
        qid = sql_path.stem
        rows, err = run_query(sql_path, url)
        if rows is None:
            failures += 1
            print(f"  {qid}: FAILED\n{err}", file=sys.stderr)
            continue
        (out_dir / f"{qid}.json").write_text(json.dumps(rows, indent=2) + "\n")
        print(f"  {qid}: {len(rows)} rows")

    print(f"wrote {len(sql_files) - failures} result files to {out_dir}")
    if failures:
        sys.exit(f"{failures} quer{'y' if failures == 1 else 'ies'} failed to execute")


if __name__ == "__main__":
    main()
