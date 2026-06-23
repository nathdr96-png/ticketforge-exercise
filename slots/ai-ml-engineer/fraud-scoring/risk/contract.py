"""What the contract says, read from the contract.

Nothing in this module decides anything. Every value here comes out of
`contract/risk/` — the column availability lists from `data/MANIFEST.json`, the
metric bars from `rules.yaml` — so that this implementation and the grader cannot
drift apart by a copy-paste. The one thing that is NOT read from the contract is
the model itself, which is the part that is actually the work.
"""

from __future__ import annotations

import hashlib
import json
import pathlib

import yaml

KEY = "order_id"
LABEL = "is_fraud"

# The three files `make run` must score, in the order the contract lists them.
INPUT_FILES = ("holdout", "holdout_masked", "holdout_shard")

# The contract requires exactly six digits after the decimal point, so that two
# runs are compared as text and "deterministic" has one meaning rather than a
# tolerance. See RISK-R07.
SCORE_DECIMALS = 6


def repo_root() -> pathlib.Path:
    """The repository root, found by looking for the contract rather than by
    counting `..`s.

    A copy of this slot can sit at any depth below the repository root — in
    place, as a work copy beside it, or in a workspace elsewhere. Searching
    upwards for the contract is the only version of this that is right in all
    of them.
    """
    here = pathlib.Path(__file__).resolve()
    for candidate in here.parents:
        if (candidate / "contract" / "risk" / "rules.yaml").is_file():
            return candidate
    raise SystemExit(
        "could not find contract/risk/rules.yaml above "
        f"{here} — is this slot inside a TicketForge checkout?"
    )


ROOT = repo_root()
RISK_DIR = ROOT / "contract" / "risk"
DATA_DIR = RISK_DIR / "data"


def _manifest() -> dict:
    return json.loads((DATA_DIR / "MANIFEST.json").read_text())


MANIFEST = _manifest()
RULES = yaml.safe_load((RISK_DIR / "rules.yaml").read_text())

# Which columns exist and which of them we are allowed to look at. RISK-R02 is
# the headline rule of this family, and taking the two lists from the contract
# means a column that is reclassified there is reclassified here too.
ORDER_TIME_COLUMNS: list[str] = list(MANIFEST["order_time_columns"])
POST_REVIEW_COLUMNS: list[str] = list(MANIFEST["post_review_columns"])

SHARD_EVERY: int = int(MANIFEST["shard_every"])
SPLIT_AT: str = str(MANIFEST["split_at"])


def dataset_path(name: str) -> pathlib.Path:
    return DATA_DIR / f"{name}.csv"


def bar(name: str) -> float:
    """A declared minimum out of rules.yaml, by name, with no local default."""
    bars = RULES["metric"]["bars"]
    if name in bars:
        return float(bars[name]["min"])
    operational = RULES["metric"]["operational"]
    if name in operational:
        return float(operational[name]["min"])
    raise KeyError(f"contract/risk/rules.yaml declares no bar named {name!r}")


def verify_dataset() -> None:
    """RISK-R12: the dataset is fixed, and these digests say so.

    Checked before training rather than after, because a drifted training file
    makes every number this slot prints a number about a different dataset. The
    grader runs the same check; doing it here too means the failure lands where
    somebody can read it.
    """
    for name, want in MANIFEST["files"].items():
        if "_note" in want:  # an annotated entry, not a file in contract/risk/data/
            continue
        path = DATA_DIR / name
        if not path.is_file():
            raise SystemExit(f"{path} is missing — the dataset is part of the contract")
        got = hashlib.sha256(path.read_bytes()).hexdigest()
        if got != want["sha256"]:
            raise SystemExit(
                f"{path.relative_to(ROOT)} has drifted from contract/risk/data/MANIFEST.json\n"
                f"  expected sha256 {want['sha256']}\n"
                f"  found           {got}\n"
                "The declared metric bars were measured against the committed dataset. "
                "Restore it (git checkout) rather than regenerating it — see RISK-R12."
            )
