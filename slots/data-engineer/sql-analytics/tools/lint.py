#!/usr/bin/env python3
"""`make lint` — static checks on the query files.

    python3 tools/lint.py

Nothing here needs a database. These are the mistakes that reviewers in this
codebase keep catching by hand:

  * a query with no ORDER BY, when every question in the contract requires one;
  * `created_at::date`, which buckets in the session timezone rather than UTC;
  * a float or double cast anywhere near money;
  * `SELECT *`, which makes the output columns depend on the schema;
  * a file whose name does not match a question id in the contract.
"""

from __future__ import annotations

import pathlib
import re
import sys

SLOT = pathlib.Path(__file__).resolve().parents[1]
QUERIES = SLOT / "queries"
CONTRACT_QUESTIONS = SLOT.parents[2] / "contract" / "analytics" / "questions.yaml"

problems: list[str] = []


def strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    return re.sub(r"/\*.*?\*/", "", sql, flags=re.S)


def known_question_ids() -> set[str]:
    """Pulled out of questions.yaml with a regex rather than a YAML parser: this
    slot deliberately has no Python dependencies to install."""
    text = CONTRACT_QUESTIONS.read_text()
    return set(re.findall(r"^\s*-\s+id:\s*([A-Za-z0-9_]+)\s*$", text, flags=re.M))


def main() -> None:
    ids = known_question_ids()
    if not ids:
        sys.exit(f"could not read any question ids from {CONTRACT_QUESTIONS}")

    files = sorted(QUERIES.glob("*.sql"))
    if not files:
        sys.exit(f"no queries found in {QUERIES}")

    for path in files:
        qid = path.stem
        raw = path.read_text()
        body = strip_comments(raw)

        if qid not in ids:
            problems.append(f"{path.name}: {qid} is not a question id in "
                            f"contract/analytics/questions.yaml")
        if not re.search(r"\border\s+by\b", body, flags=re.I):
            problems.append(f"{path.name}: no ORDER BY — every question requires a defined order")
        if re.search(r"created_at\s*::\s*date", body, flags=re.I):
            problems.append(f"{path.name}: created_at::date buckets in the session timezone; "
                            f"use (created_at AT TIME ZONE 'UTC')::date")
        if re.search(r"::\s*(float|real|double\s+precision)\b", body, flags=re.I):
            problems.append(f"{path.name}: float cast in a query that handles integer money")
        if re.search(r"\bselect\s+\*", body, flags=re.I):
            problems.append(f"{path.name}: SELECT * makes the output columns depend on the schema")
        if not body.rstrip().endswith(";"):
            problems.append(f"{path.name}: does not end with a semicolon")
        if not raw.lstrip().startswith("--"):
            problems.append(f"{path.name}: no header comment saying which question it answers")

    missing = ids - {p.stem for p in files}
    for qid in sorted(missing):
        problems.append(f"no query file for contract question {qid}")

    print(f"linted {len(files)} quer{'y' if len(files) == 1 else 'ies'} in {QUERIES}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("clean")


if __name__ == "__main__":
    main()
