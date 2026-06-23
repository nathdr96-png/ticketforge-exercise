"""The model and the run, against the rules it is graded on.

These tests fit real models, so they are the slow ones — three fits, around a
minute. They are worth it: every assertion here corresponds to a rule in
`contract/risk/rules.yaml`.

The one thing these tests CANNOT do is measure the graded metric: the holdout's
labels are withheld and are not in this tree. So the metric is measured the only
honest way available from inside the slot — on a temporal validation split carved
out of `train.csv`.
"""

from __future__ import annotations

import pathlib

import numpy as np
import pandas as pd
import pytest

from risk import contract, metrics
from risk.model import clean, fit
from risk.pipeline import format_score, load, run

VALIDATION_SPLIT_AT = "2026-07-11T00:00:00Z"


@pytest.fixture(scope="module")
def train() -> pd.DataFrame:
    return load("train")


@pytest.fixture(scope="module")
def holdout() -> pd.DataFrame:
    return load("holdout")


@pytest.fixture(scope="module")
def model(train):
    return fit(train)


@pytest.fixture(scope="module")
def scores(model, holdout) -> np.ndarray:
    return model.score(holdout)


# ------------------------------------------------------------------- RISK-R07
def test_two_fits_produce_identical_scores(train, holdout, scores):
    """Determinism, in process. `make run` proves the same thing across two
    processes, which is what the grader measures; this is the fast version that
    tells you which line broke it."""
    again = fit(train).score(holdout)
    assert np.array_equal(scores, again)


# ------------------------------------------------------------------- RISK-R08
def test_scoring_a_subset_gives_the_same_scores(model, holdout, scores):
    """An order's score must not depend on which other orders are in the batch.
    This is the in-process version of the shard check: anything fitted, pooled or
    normalised across the rows being scored fails it."""
    shard = holdout.iloc[:: contract.SHARD_EVERY].reset_index(drop=True)
    assert np.array_equal(model.score(shard), scores[:: contract.SHARD_EVERY])


def test_scoring_one_row_at_a_time_gives_the_same_scores(model, holdout, scores):
    """The strongest form of RISK-R08: in production the batch size is one."""
    for i in (0, 7, 100, len(holdout) - 1):
        one = holdout.iloc[[i]].reset_index(drop=True)
        assert model.score(one)[0] == pytest.approx(scores[i], abs=1e-12)


# ------------------------------------------------------------------- RISK-R05
def test_nulling_the_post_review_columns_changes_nothing(model, scores):
    """RISK-R02 made arithmetic. A model that never reads those columns passes
    this without trying; a model that reads one cannot pass it at all."""
    masked = model.score(load("holdout_masked"))
    assert np.array_equal(masked, scores)


# ------------------------------------------------------------------- RISK-R06
def test_scores_are_a_distribution_and_not_a_decision(scores):
    assert scores.min() >= 0.0 and scores.max() <= 1.0
    rounded = np.round(scores, contract.SCORE_DECIMALS)
    assert len(set(rounded)) >= 200
    _, counts = np.unique(rounded, return_counts=True)
    assert counts.max() / len(rounded) <= 0.25


def test_score_formatting():
    assert format_score(0.0) == "0.000000"
    assert format_score(1.0) == "1.000000"
    assert format_score(0.1234564) == "0.123456"
    # A probability a hair outside [0, 1] is clipped rather than fatal.
    assert format_score(1.0000000000000002) == "1.000000"
    assert format_score(-1e-18) == "0.000000"


# ------------------------------------------------------------------- RISK-R09
def test_cleaning_keeps_the_rows_with_missing_values(train):
    """`dropna()` here would delete most of the positive class, because these
    columns are missing for reasons that correlate with fraud."""
    cleaned = clean(train)
    nullable = ["card_country", "billing_country_matches_card", "hold_to_checkout_seconds"]
    assert cleaned[nullable].isna().any(axis=1).sum() > 0
    positives_before = int(train[contract.LABEL].sum())
    assert int(cleaned[contract.LABEL].sum()) == positives_before


def test_cleaning_drops_duplicate_orders():
    frame = load("train")
    doubled = pd.concat([frame, frame.iloc[:5]], ignore_index=True)
    assert len(clean(doubled)) == len(clean(frame))


# ---------------------------------------------------------- the metric and bars
def test_clears_the_contracts_bars_on_a_validation_split(train):
    """The graded holdout's labels are withheld, so this is measured on the last
    three weeks of train.csv — fitted on the rest, temporally split like the
    contract's own.

    The bars come from contract/risk/rules.yaml rather than being written out
    again here, so a bar that moves there moves here.
    """
    cut = train["created_at"] < VALIDATION_SPLIT_AT
    early, late = train[cut].reset_index(drop=True), train[~cut].reset_index(drop=True)
    model = fit(early)
    scores = model.score(late)
    ids = list(late[contract.KEY])
    labels = late[contract.LABEL].astype(int).to_numpy()

    ap = metrics.average_precision(ids, scores, labels)
    auc = metrics.roc_auc(ids, scores, labels)
    p100 = metrics.precision_at_k(ids, scores, labels, 100)
    constant = metrics.average_precision(ids, np.zeros(len(ids)), labels)

    assert ap >= contract.bar("average_precision_holdout"), f"average precision {ap:.4f}"
    assert auc >= contract.bar("roc_auc_holdout"), f"roc auc {auc:.4f}"
    assert p100 >= contract.bar("precision_at_100"), f"precision@100 {p100:.4f}"
    # RISK-R04: and the bar is not something a constant could reach.
    assert ap > 5 * constant


# ----------------------------------------------------------- the run, end to end
def test_run_writes_every_declared_file(tmp_path: pathlib.Path, holdout):
    written = run(tmp_path)
    assert sorted(written) == sorted(contract.INPUT_FILES)
    for name, path in written.items():
        rows = pd.read_csv(path, dtype={contract.KEY: "string"})
        assert list(rows.columns) == ["order_id", "risk_score"]
        expected = list(load(name)[contract.KEY])
        assert list(rows[contract.KEY]) == expected
        text = path.read_text().splitlines()
        assert text[0] == "order_id,risk_score"
        for line in text[1:]:
            assert len(line.split(",")[1].split(".")[1]) == contract.SCORE_DECIMALS
