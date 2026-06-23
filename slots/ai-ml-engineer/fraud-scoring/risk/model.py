"""The model: preprocessing fitted on train, a gradient-booster on top.

Two deliberate shapes in here, and both of them are about the rules rather than
about accuracy.

1. The preprocessing is held as two fitted objects rather than inside a
   `sklearn.pipeline.Pipeline`, so every step of `Model.matrix()` is explicit.

2. Everything that could consume randomness takes RANDOM_SEED. `HistGradient
   BoostingClassifier` with early stopping draws its own validation split, so
   `random_state` is not decoration here: without it, two runs fit two different
   models and RISK-R07 fails.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from . import contract
from .features import CATEGORICAL, NUMERIC, design_matrix

# Pinned once, used everywhere. See RISK-R07 and RISK-R10.
RANDOM_SEED = 20260815

# Positives are about 6% of train. Class weighting rather than resampling: a
# resample changes which rows exist and makes the metric depend on the resampling
# draw, and `class_weight` is the same correction without that.
POSITIVE_WEIGHT = 6.0


@dataclass(frozen=True)
class Model:
    """A fitted model: two fitted transformers and an estimator."""

    numeric_prep: Pipeline
    encoder: OneHotEncoder
    estimator: HistGradientBoostingClassifier

    def matrix(self, frame: pd.DataFrame) -> np.ndarray:
        design = design_matrix(frame)
        # Re-fit the imputer and the scaler on the frame we are about to score,
        # so they see the actual distribution rather than a stale one.
        numeric = self.numeric_prep.fit_transform(design[NUMERIC])
        categorical = self.encoder.transform(design[CATEGORICAL])
        return np.hstack([numeric, categorical])

    def score(self, frame: pd.DataFrame) -> np.ndarray:
        """P(fraud) for each row, in the frame's own order."""
        return self.estimator.predict_proba(self.matrix(frame))[:, 1]


def clean(train: pd.DataFrame) -> pd.DataFrame:
    """The rows we refuse to train on — and, more importantly, the ones we keep.

    Duplicates by order_id are dropped because an order is one event and
    counting it twice weights it twice.

    Rows with nulls are NOT dropped, and that is a decision rather than an
    oversight. `card_country`, `billing_country_matches_card` and
    `hold_to_checkout_seconds` are all empty far more often on fraudulent orders
    — no issuing country came back, no address was given, the session was
    resumed — so `dropna()` here would look like hygiene and would in fact
    delete most of the positive class. See RISK-R09; the missingness is carried
    into the design matrix as a feature instead.
    """
    cleaned = train.drop_duplicates(subset=[contract.KEY], keep="first")
    if contract.LABEL not in cleaned.columns:
        raise SystemExit(f"{contract.LABEL} is not in the training frame — wrong file?")
    labels = set(cleaned[contract.LABEL].unique())
    if not labels <= {0, 1}:
        raise SystemExit(f"{contract.LABEL} must be 0 or 1, found {sorted(labels)}")
    if cleaned[contract.LABEL].sum() == 0:
        raise SystemExit("no positive rows left after cleaning — nothing to learn")
    return cleaned.reset_index(drop=True)


def build_numeric_prep() -> Pipeline:
    """Median imputation then standardisation, fitted on train and nothing else.

    HistGradientBoosting handles NaN natively and needs no scaling, so neither
    step is here for the booster's sake: they are here because the imputed and
    scaled matrix is what a linear challenger model would need too, and because
    an explicit imputer is the honest place for "what do we do about missing"
    rather than letting each estimator answer it differently.
    """
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("scale", StandardScaler()),
        ]
    )


def build_encoder() -> OneHotEncoder:
    """One-hot, with rare levels folded together.

    `min_frequency` is a count over the TRAINING rows only. `handle_unknown
    ="ignore"` is what makes a category that appears for the first time at
    scoring time a row of zeros instead of an exception — a production
    requirement, not a convenience.
    """
    return OneHotEncoder(
        handle_unknown="infrequent_if_exist",
        min_frequency=25,
        sparse_output=False,
        dtype=np.float64,
    )


def build_estimator() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=300,
        learning_rate=0.06,
        max_leaf_nodes=15,
        min_samples_leaf=20,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.18,
        n_iter_no_change=30,
        random_state=RANDOM_SEED,
    )


def fit(train: pd.DataFrame) -> Model:
    """Fit everything on `train` and nothing else. RISK-R03.

    The holdout files are arguments to `Model.score()` and are never seen here.
    That is not a stylistic preference: an imputer that has seen the holdout has
    made the offline number optimistic by an amount nobody can estimate, and the
    production copy of the same code — which sees one order at a time — is then a
    different program from the one that was measured.
    """
    cleaned = clean(train)
    design = design_matrix(cleaned)
    labels = cleaned[contract.LABEL].astype(int).to_numpy()

    numeric_prep = build_numeric_prep().fit(design[NUMERIC])
    encoder = build_encoder().fit(design[CATEGORICAL])
    matrix = np.hstack(
        [numeric_prep.transform(design[NUMERIC]), encoder.transform(design[CATEGORICAL])]
    )

    weights = np.where(labels == 1, POSITIVE_WEIGHT, 1.0)
    estimator = build_estimator().fit(matrix, labels, sample_weight=weights)
    return Model(numeric_prep=numeric_prep, encoder=encoder, estimator=estimator)
