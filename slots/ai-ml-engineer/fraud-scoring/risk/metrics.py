"""Average precision and friends, implemented here rather than imported.

`sklearn.metrics.average_precision_score` would do, and this file agrees with it
to within floating-point noise whenever the scores are distinct (there is a unit
test for that). It is written out because the grader in `conformance/ml/`
implements the same definition in TypeScript, and two independent
implementations of the metric that agree are worth more than one implementation
used twice: if this slot and the grader ever disagree about a number, the
disagreement is a bug rather than an opinion.

The one place it departs from sklearn is TIES, and that is deliberate. The
contract declares a tie-break — equal scores ordered by order_id ascending
(`metric.primary.tie_breaking`) — because a model that emits a handful of
distinct values would otherwise get whichever ordering happened to flatter it.
sklearn instead collapses every tie to a single threshold, which for a constant
score returns the base rate exactly. Both are defensible; the contract picks
one, and the contract records the measured figure for a constant score rather
than the textbook one.
"""

from __future__ import annotations

import numpy as np


def _ranked(ids: list[str], scores: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Labels, ordered by score descending with ties broken by id ascending."""
    order = sorted(range(len(ids)), key=lambda i: (-float(scores[i]), ids[i]))
    return labels[order]


def average_precision(ids: list[str], scores: np.ndarray, labels: np.ndarray) -> float:
    """Area under the precision-recall curve, as the contract defines it:

        sum_k (R_k - R_{k-1}) * P_k

    over the ranking. This is the step-function ("average precision") form, not
    a trapezoidal interpolation of the PR curve: interpolation is optimistic on a
    rare class, and the contract declares the summation.
    """
    positives = int(labels.sum())
    if positives == 0:
        raise ValueError("average precision is undefined with no positive rows")
    ranked = _ranked(ids, scores, labels)
    hits = 0
    total = 0.0
    for i, label in enumerate(ranked, start=1):
        if label:
            hits += 1
            total += hits / i
    return total / positives


def roc_auc(ids: list[str], scores: np.ndarray, labels: np.ndarray) -> float:
    """Mann-Whitney U, with proper mid-rank handling for ties.

    Ties matter: a model that emits a handful of distinct values has a lot of
    them, and counting each tie as a win would be a free half-point.
    """
    order = np.argsort(scores, kind="stable")
    sorted_scores = scores[order]
    ranks = np.empty(len(scores), dtype=np.float64)
    i = 0
    while i < len(sorted_scores):
        j = i
        while j + 1 < len(sorted_scores) and sorted_scores[j + 1] == sorted_scores[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    n_pos = float(labels.sum())
    n_neg = float(len(labels) - n_pos)
    if n_pos == 0 or n_neg == 0:
        raise ValueError("ROC AUC is undefined with only one class present")
    return (ranks[labels == 1].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def precision_at_k(ids: list[str], scores: np.ndarray, labels: np.ndarray, k: int) -> float:
    """What fraction of the top k of Support's queue is actually fraud."""
    ranked = _ranked(ids, scores, labels)
    k = min(k, len(ranked))
    return float(ranked[:k].sum()) / k
