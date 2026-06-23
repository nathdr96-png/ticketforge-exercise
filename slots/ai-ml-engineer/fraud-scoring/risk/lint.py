"""`make lint`: static hygiene checks for the modelling code.

Not a style checker, and not a substitute for review: whether a model is sound
is a question about the data and the method, which `contract/risk/rules.yaml`
states and the metrics measure. This checks only that the pipeline is a pure
function of the committed dataset (RISK-R10), so that two runs on two machines
score the same rows the same way.

    python -m risk.lint

Comments and docstrings are stripped before the source is scanned, so
explanatory comments do not trip the rule.
"""

from __future__ import annotations

import io
import pathlib
import sys
import tokenize

SLOT = pathlib.Path(__file__).resolve().parents[1]
# This module is exempt: its own rule table would otherwise match the rule.
EXEMPT = {"lint.py"}


def code_only(path: pathlib.Path) -> str:
    """The file's source with comments and string literals removed."""
    out: list[str] = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(path.read_text()).readline):
            if tok.type in (tokenize.COMMENT, tokenize.STRING):
                continue
            out.append(tok.string)
    except tokenize.TokenError as err:  # pragma: no cover - a syntax error fails below
        raise SystemExit(f"{path.name}: cannot tokenise ({err})")
    return "\n".join(out)


def sources() -> dict[str, str]:
    return {
        path.name: code_only(path)
        for path in sorted((SLOT / "risk").glob("*.py"))
        if path.name not in EXEMPT
    }


def main() -> int:
    problems: list[str] = []
    src = sources()

    # RISK-R10 — nothing may depend on the clock or the environment.
    for name, text in src.items():
        if name == "contract.py":
            continue  # it resolves the repository root, which is a path, not state
        for bad in ("datetime.now", "time.time", "os.environ", "getenv", "urllib", "requests"):
            if bad in text:
                problems.append(
                    f"RISK-R10  {name} uses {bad}. The pipeline must be a function of "
                    "the committed dataset and nothing else."
                )

    if problems:
        print("lint: FAIL")
        for problem in problems:
            print(f"  {problem}")
        return 1

    print(f"lint: ok — {len(src)} modules, no clock, environment or network access")
    return 0


if __name__ == "__main__":
    sys.exit(main())
