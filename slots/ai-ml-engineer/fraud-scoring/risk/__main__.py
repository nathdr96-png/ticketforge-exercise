"""Entry point.

    python -m risk --out $PREDICTIONS_DIR/run1
    python -m risk --report

`--out` is one run of the graded pipeline. `--report` is the development loop: it
holds out the last three weeks of `train.csv`, fits on the rest, and prints the
metrics the contract declares — the only honest self-assessment available here,
because the graded holdout's labels are not in this repository.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
import pandas as pd

from . import contract, metrics
from .features import assert_no_post_review_columns
from .model import fit
from .pipeline import load, run

# Three weeks, so the validation split is a temporal one like the contract's
# (dataset.split.kind == temporal) rather than a random one that would let the
# model see a buyer's future.
REPORT_SPLIT_AT = "2026-07-11T00:00:00Z"


def report() -> int:
    """Fit on the earlier part of train, measure on the later part."""
    assert_no_post_review_columns()
    contract.verify_dataset()
    train = load("train")
    cut = train["created_at"] < REPORT_SPLIT_AT
    early, late = train[cut].reset_index(drop=True), train[~cut].reset_index(drop=True)
    if late[contract.LABEL].sum() < 20:
        raise SystemExit(f"validation split has only {late[contract.LABEL].sum()} positives")

    model = fit(early)
    scores = model.score(late)
    ids = list(late[contract.KEY])
    labels = late[contract.LABEL].astype(int).to_numpy()

    ap = metrics.average_precision(ids, scores, labels)
    auc = metrics.roc_auc(ids, scores, labels)
    p100 = metrics.precision_at_k(ids, scores, labels, 100)
    constant = metrics.average_precision(ids, np.zeros(len(ids)), labels)

    print(f"validation split      {REPORT_SPLIT_AT} -> {len(late)} orders, "
          f"{int(labels.sum())} fraud ({labels.mean():.3%})")
    print(f"average precision     {ap:.4f}   (contract bar "
          f"{contract.bar('average_precision_holdout'):.2f} on the real holdout)")
    print(f"roc auc               {auc:.4f}   (contract bar "
          f"{contract.bar('roc_auc_holdout'):.2f})")
    print(f"precision@100         {p100:.4f}   (contract bar "
          f"{contract.bar('precision_at_100'):.2f})")
    print(f"'never fraud' AP      {constant:.4f}   <- what a constant scores")
    print(f"distinct scores       {len(set(np.round(scores, contract.SCORE_DECIMALS)))}")
    print()
    print("This is a self-measurement on part of train.csv, not your grade. The "
          "graded holdout's labels are withheld; see contract/risk/README.md.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="risk", description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--out", metavar="DIR", help="write one run's predictions here")
    group.add_argument("--report", action="store_true", help="print validation metrics")
    args = parser.parse_args(argv)

    if args.report:
        return report()

    out = pathlib.Path(args.out).expanduser().resolve()
    written = run(out)
    for name, path in written.items():
        rows = pd.read_csv(path)
        print(f"wrote {path}  ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
