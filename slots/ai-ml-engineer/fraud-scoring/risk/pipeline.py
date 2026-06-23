"""`make run`: train on train.csv, score the three holdout files, write CSV.

One invocation of this module is one run. `make run` invokes it twice, into
`run1/` and `run2/`, because the grader cannot run the candidate's code twice and
RISK-R07 has to be measurable from the outside: two separate processes, and
identical output is the assertion.

What is NOT in here is as deliberate as what is:

  * nothing reads the clock, the hostname or the locale (RISK-R10);
  * nothing touches the network;
  * no scoring frame reaches `fit()` (RISK-R03);
  * nothing is computed across the rows being scored, so an order's score is the
    same alone as it is in a batch of two thousand (RISK-R08).
"""

from __future__ import annotations

import pathlib

import numpy as np
import pandas as pd

from . import contract
from .model import fit


def load(name: str) -> pd.DataFrame:
    """Read one contract CSV.

    `keep_default_na=False` is deliberately NOT used: an empty cell in this
    dataset means "not observed", and the nullable columns are nullable for
    reasons that correlate with fraud (RISK-R09). Reading them as the string ""
    would turn a missing value into a category and quietly lose that.

    `dtype=str` for the key keeps order ids as written, so the output joins
    against the input by text and not by some inferred numeric type.
    """
    path = contract.dataset_path(name)
    if not path.is_file():
        raise SystemExit(f"{path} is missing — the dataset is part of the contract")
    return pd.read_csv(path, dtype={contract.KEY: "string"})


def format_score(value: float) -> str:
    """One score, as the contract spells it: six digits after the point, in [0, 1].

    Clipped rather than asserted: a predicted probability can leave [0, 1] by a
    floating-point hair, and failing a whole run over 1.0000000000000002 would be
    theatre. Anything genuinely outside the interval is a bug the grader will see
    as a bad metric, which is the right place for it.
    """
    clipped = min(1.0, max(0.0, float(value)))
    return f"{clipped:.{contract.SCORE_DECIMALS}f}"


def write_predictions(path: pathlib.Path, ids: pd.Series, scores: np.ndarray) -> None:
    """Write `order_id,risk_score`, one row per input order, in the input's order.

    Written by hand rather than with `DataFrame.to_csv` so the number formatting
    is this file's decision and cannot change under a pandas release. RISK-R07
    compares two runs as text; a float repr that moves between versions would
    make determinism a property of the environment.
    """
    if len(ids) != len(scores):
        raise SystemExit(f"{path.name}: {len(ids)} ids but {len(scores)} scores")
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["order_id,risk_score"]
    lines += [f"{order_id},{format_score(score)}" for order_id, score in zip(ids, scores)]
    path.write_text("\n".join(lines) + "\n")


def run(out_dir: pathlib.Path) -> dict[str, pathlib.Path]:
    """Fit once, score every input file, write one CSV each.

    The model is fitted ONCE, outside the loop over the scoring frames. That is
    not an optimisation: fitting inside the loop is how the preprocessing ends up
    seeing the frame it is about to score, which is RISK-R03 and RISK-R08 broken
    at a stroke, and the shard file exists to catch exactly that.
    """
    contract.verify_dataset()
    model = fit(load("train"))

    written: dict[str, pathlib.Path] = {}
    for name in contract.INPUT_FILES:
        frame = load(name)
        scores = model.score(frame)
        path = out_dir / f"{name}.csv"
        write_predictions(path, frame[contract.KEY], scores)
        written[name] = path
    return written
