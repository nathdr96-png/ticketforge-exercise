"""The metric implementation, against known answers and against scikit-learn.

`risk/metrics.py` exists so that this slot and the TypeScript grader in
`conformance/ml/` are two independent implementations of the contract's
definition. That is only worth anything if this one is right, so it is checked
both against hand-computed examples and against sklearn.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from risk.metrics import average_precision, precision_at_k, roc_auc

RNG = np.random.default_rng(20260815)


def test_perfect_ranking_scores_one():
    ids = ["a", "b", "c", "d"]
    scores = np.array([0.9, 0.8, 0.2, 0.1])
    labels = np.array([1, 1, 0, 0])
    assert average_precision(ids, scores, labels) == 1.0
    assert roc_auc(ids, scores, labels) == 1.0


def test_hand_computed_example():
    # Ranking: a(1) b(0) c(1). Precision at the hits: 1/1 and 2/3.
    ids = ["a", "b", "c"]
    scores = np.array([0.9, 0.5, 0.1])
    labels = np.array([1, 0, 1])
    assert average_precision(ids, scores, labels) == (1.0 + 2.0 / 3.0) / 2


def test_a_constant_score_is_nowhere_near_the_bar():
    """RISK-R04: this is what "never fraud" is worth.

    Note what it is NOT: exactly the base rate. When every score is equal the
    ranking is the contract's id tie-break alone, so the figure depends on where
    the positives happen to sit in the id space — and the contract records the
    MEASURED value for the real holdout (0.0538 against a base rate of 0.0441)
    rather than the textbook one. sklearn collapses all ties to one threshold and
    returns the base rate instead; that difference is deliberate and declared,
    and it only ever appears for tied scores.

    What matters is the order of magnitude, and this asserts that.
    """
    rng = np.random.default_rng(7)
    n = 2000
    ids = [f"o{i:04d}" for i in range(n)]
    labels = (rng.random(n) < 0.044).astype(int)
    ap = average_precision(ids, np.zeros(n), labels)
    assert 0.02 < ap < 0.15
    assert ap < 0.40  # the contract's declared minimum


def test_the_tie_break_is_the_whole_ranking_when_scores_are_equal():
    """The precise version of the above, small enough to check by hand.

    Three orders, all scored 0.5, labels on the first and the third by id. The
    ranking is a, b, c; the hits are at positions 1 and 3; so the figure is
    (1/1 + 2/3) / 2.
    """
    ids = ["a", "b", "c"]
    labels = np.array([1, 0, 1])
    assert average_precision(ids, np.full(3, 0.5), labels) == (1.0 + 2.0 / 3.0) / 2


def test_ties_are_broken_by_order_id_ascending():
    """The contract declares the tie-break so a model that emits a handful of
    distinct values gets one defined answer rather than a favourable one."""
    labels_a = np.array([0, 1])
    assert average_precision(["a", "b"], np.array([0.5, 0.5]), labels_a) == 0.5
    labels_b = np.array([1, 0])
    assert average_precision(["a", "b"], np.array([0.5, 0.5]), labels_b) == 1.0


def test_agrees_with_sklearn_on_random_problems():
    for _ in range(25):
        n = int(RNG.integers(50, 400))
        labels = (RNG.random(n) < 0.06).astype(int)
        if labels.sum() == 0 or labels.sum() == n:
            continue
        scores = RNG.random(n)
        ids = [f"o{i:05d}" for i in range(n)]
        assert abs(average_precision(ids, scores, labels) - average_precision_score(labels, scores)) < 1e-9
        assert abs(roc_auc(ids, scores, labels) - roc_auc_score(labels, scores)) < 1e-9


def test_roc_auc_handles_ties_as_half_credit():
    labels = np.array([1, 0])
    assert roc_auc(["a", "b"], np.array([0.5, 0.5]), labels) == 0.5


def test_precision_at_k():
    ids = [f"o{i}" for i in range(10)]
    scores = np.linspace(1.0, 0.1, 10)
    labels = np.array([1, 1, 0, 1, 0, 0, 0, 0, 0, 0])
    assert precision_at_k(ids, scores, labels, 3) == 2 / 3
    assert precision_at_k(ids, scores, labels, 100) == 0.3
