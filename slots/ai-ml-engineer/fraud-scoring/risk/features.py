"""The design matrix: which columns go into the model, and what is derived.

This is the half of the work that decides whether the model is any good, and the
half that decides whether it is legal. Both halves are here on purpose — the
feature list and the rule it obeys should be readable in one place.

RISK-R02: every name below is in `contract/risk/data/MANIFEST.json`'s
`order_time_columns`, or is derived from those columns row by row, and
`assert_no_post_review_columns()` is what makes that a check rather than a claim.
The three `post_review` columns are in the CSVs, they are strongly predictive,
and they are empty in production for every order Support is actually triaging.

RISK-R08: nothing here is a statistic over the frame. Every value is a function
of its own row, which is what makes an order's score the same whether it arrives
alone or in a batch of two thousand.

The features are in two blocks and the split is not cosmetic. ORDER is what was
bought. ACCOUNT is who bought it and how — the account's standing, the velocity
around it, the payment surface, and the shape of the checkout. ACCOUNT is where
most of the signal is, and it is the part a reviewer looks at first: an eight-seat
arena order is unremarkable until you know the account opened forty minutes ago.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import contract

TRUTHY = {"true": 1.0, "True": 1.0, True: 1.0, 1: 1.0, "1": 1.0}
FALSY = {"false": 0.0, "False": 0.0, False: 0.0, 0: 0.0, "0": 0.0}


def boolean(series: pd.Series) -> pd.Series:
    """`true` / `false` / empty from the CSV to 1.0 / 0.0 / NaN.

    Nullable booleans are real here — `billing_country_matches_card` is empty
    when no address was given, which happens far more often on abusive traffic —
    so an empty cell must stay missing and not quietly become False. See
    RISK-R09.
    """
    return series.map(lambda v: TRUTHY.get(v, FALSY.get(v, np.nan))).astype("float64")


# ========================================================= the order itself ==
# What was bought, for how much, in which currency. Everything in this block is
# on the order row.
ORDER_NUMERIC = [
    "seat_count",
    "subtotal_cents",
    "discount_cents",
    "fee_cents",
    "total_cents",
    "created_hour",
    "created_dow",
    "cents_per_seat",
    "discount_share_bps",
]

ORDER_CATEGORICAL = [
    "event_id",
    "currency",
    "seat_section",
    "discount_code",
]


def order_features(out: pd.DataFrame, frame: pd.DataFrame) -> None:
    """Fill in every name in ORDER_NUMERIC."""
    for col in ("seat_count", "subtotal_cents", "discount_cents", "fee_cents", "total_cents"):
        out[col] = pd.to_numeric(frame[col], errors="coerce").astype("float64")

    created = pd.to_datetime(frame["created_at"], format="%Y-%m-%dT%H:%M:%SZ", utc=True)
    out["created_hour"] = created.dt.hour.astype("float64")
    out["created_dow"] = created.dt.dayofweek.astype("float64")

    out["cents_per_seat"] = out["total_cents"] / out["seat_count"].replace(0, np.nan)
    # Basis points rather than a fraction: the money columns are integer minor
    # units and stay that way (RISK-R11); this is a derived ratio, not money.
    out["discount_share_bps"] = (
        10_000.0 * out["discount_cents"] / out["subtotal_cents"].replace(0, np.nan)
    )


# ============================================== the account and the session ==
# Who bought it and how: the account's standing and history, the velocity around
# the order, the payment surface, and the shape of the checkout. This block is
# what turns "a large order" into "a large order from an account that opened
# yesterday, with its third card, paid six seconds after the hold was created",
# and it is where most of the signal lives.
# TODO(FEAT-806): the model does not look at the account or the session at all
# yet, only at what was bought. See the ticket for what it has to take into
# account, and read contract/risk/rules.yaml for how each input is checked.
ACCOUNT_NUMERIC: list[str] = []

ACCOUNT_CATEGORICAL: list[str] = []


def account_features(out: pd.DataFrame, frame: pd.DataFrame) -> None:
    """Not implemented yet — see FEAT-806."""
    return None


# ============================================================= composition ==
# Every name this module is allowed to invent, as opposed to read from the CSV.
# `assert_no_post_review_columns()` checks the feature list against the
# contract's own column lists plus this vocabulary, so a typo in a feature name
# is an error rather than a silently absent column.
DERIVED_NUMERIC = [
    "created_hour",
    "created_dow",
    "cents_per_seat",
    "discount_share_bps",
    "ip_orders_per_buyer_order",
    "cards_per_prior_order",
    "is_rapid_checkout",
    "account_is_fresh",
    "card_country_missing",
    "hold_seconds_missing",
    "billing_match_missing",
    "missing_order_time_columns",
]

# `buyer_id` is deliberately NOT a feature. It has 950 levels, 900 of which are
# nearly singletons, so one-hot encoding it is noise and target-encoding it is a
# RISK-R08 violation waiting to happen: the encoding would be a statistic over
# rows, and the score of one order would then depend on which other orders were
# in the batch. What matters about the buyer is in ACCOUNT_NUMERIC already.
EXCLUDED = ["buyer_id", "created_at", contract.KEY]

NUMERIC = ORDER_NUMERIC + ACCOUNT_NUMERIC

CATEGORICAL = ORDER_CATEGORICAL + ACCOUNT_CATEGORICAL


def assert_no_post_review_columns() -> None:
    """RISK-R02, as an assertion rather than a promise.

    Called by `make test` and `make lint`, not by `make run`. A model that is
    wrong should produce a bad score and be caught by the grader, not crash:
    `make run` failing is a tooling problem and tells nobody anything about the
    model.
    """
    used = set(NUMERIC) | set(CATEGORICAL)
    banned = used & set(contract.POST_REVIEW_COLUMNS)
    if banned:
        raise AssertionError(
            "RISK-R02 violated: these columns are only populated after a fraud "
            f"review and must not be used as features: {sorted(banned)}. "
            "They are near-perfect proxies for the label offline and empty in "
            "production — see contract/risk/README.md."
        )
    unknown = used - set(contract.ORDER_TIME_COLUMNS) - set(DERIVED_NUMERIC)
    if unknown:
        raise AssertionError(
            f"these feature names are in no contract column list: {sorted(unknown)}"
        )


def design_matrix(frame: pd.DataFrame) -> pd.DataFrame:
    """Raw CSV rows to the columns the model is fitted on.

    Row-wise only: every value in the returned frame is a function of that one
    row. Nothing here is a statistic over the frame, which is what makes
    RISK-R08 hold.
    """
    out = pd.DataFrame(index=frame.index)
    order_features(out, frame)
    account_features(out, frame)
    for col in CATEGORICAL:
        out[col] = frame[col].astype("string").fillna("__missing__")
    return out[NUMERIC + CATEGORICAL]
