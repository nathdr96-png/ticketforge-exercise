"""The dataset and the feature list, against the contract.

These are the cheap tests: they need no model and run in milliseconds, and they
are the ones that fail first when somebody adds a column to the feature list
without reading `contract/risk/rules.yaml`.
"""

from __future__ import annotations

import pandas as pd
import pytest

from risk import contract
from risk.features import CATEGORICAL, NUMERIC, assert_no_post_review_columns, design_matrix
from risk.pipeline import load


def test_dataset_matches_the_committed_digests():
    """RISK-R12. If this fails, every other number here is about another dataset."""
    contract.verify_dataset()


def test_no_post_review_column_is_a_feature():
    """RISK-R02, the headline rule of this family."""
    assert_no_post_review_columns()


def test_every_feature_is_an_order_time_column_or_derived_from_them():
    allowed = set(contract.ORDER_TIME_COLUMNS)
    from risk.features import DERIVED_NUMERIC

    for name in NUMERIC + CATEGORICAL:
        assert name in allowed or name in DERIVED_NUMERIC, name


def test_the_deliberately_excluded_columns_are_not_features():
    """`buyer_id` and `created_at` are in the data and are deliberately not fed
    to the model — see the comment on EXCLUDED in risk/features.py. The raw
    `created_at` is used only to derive the hour and the weekday."""
    from risk.features import EXCLUDED

    used = set(NUMERIC) | set(CATEGORICAL)
    assert used.isdisjoint(EXCLUDED), sorted(used & set(EXCLUDED))


def test_the_forbidden_columns_really_are_in_the_data():
    """A rule nobody could break is not a rule. The post-review columns are in
    the CSVs on purpose, and this test fails if a future dataset quietly drops
    them and makes RISK-R02 vacuous."""
    train = load("train")
    for column in contract.POST_REVIEW_COLUMNS:
        assert column in train.columns


def test_the_leak_is_a_leak():
    """`chargeback_filed` agrees with the label almost perfectly among reviewed
    orders. That is what makes it worth forbidding — and what makes the masked
    holdout a real test rather than a formality."""
    train = load("train")
    reviewed = train[train["chargeback_filed"].notna()]
    agreement = (reviewed["chargeback_filed"] == reviewed[contract.LABEL]).mean()
    assert agreement > 0.95


@pytest.mark.parametrize("name", ["train", "holdout", "holdout_masked", "holdout_shard"])
def test_money_obeys_the_products_pricing_rules(name):
    """The dataset's money is the product's money: integer minor units, and
    `fee = floor((subtotal - discount) * 5 / 100) + 30`. RISK-R11."""
    frame = load(name)
    subtotal = frame["subtotal_cents"]
    discount = frame["discount_cents"]
    expected_fee = (subtotal - discount) * 5 // 100 + 30
    assert (frame["fee_cents"] == expected_fee).all()
    assert (frame["total_cents"] == subtotal - discount + frame["fee_cents"]).all()


def test_the_masked_holdout_differs_only_in_the_post_review_columns():
    full = load("holdout")
    masked = load("holdout_masked")
    assert list(full[contract.KEY]) == list(masked[contract.KEY])
    for column in contract.POST_REVIEW_COLUMNS:
        assert masked[column].isna().all()
    for column in contract.ORDER_TIME_COLUMNS:
        pd.testing.assert_series_equal(full[column], masked[column], check_names=False)


def test_the_shard_is_every_third_holdout_row():
    full = load("holdout")
    shard = load("holdout_shard")
    expected = list(full[contract.KEY])[:: contract.SHARD_EVERY]
    assert list(shard[contract.KEY]) == expected


def test_the_split_is_temporal():
    """Train is strictly before the holdout. A random split would let the model
    see a buyer's later behaviour while predicting their earlier orders."""
    train, holdout = load("train"), load("holdout")
    assert train["created_at"].max() < contract.SPLIT_AT <= holdout["created_at"].min()


def test_design_matrix_is_row_wise():
    """RISK-R08 at the level of the feature code: the design matrix for a subset
    of rows is the design matrix of the whole, restricted to those rows. Anything
    computed across the frame — a mean, a frequency, a quantile — breaks this."""
    frame = load("holdout")
    whole = design_matrix(frame)
    part = design_matrix(frame.iloc[:: contract.SHARD_EVERY].reset_index(drop=True))
    pd.testing.assert_frame_equal(
        whole.iloc[:: contract.SHARD_EVERY].reset_index(drop=True), part
    )


def test_nullable_booleans_stay_missing():
    """An empty `billing_country_matches_card` must not become False: it is empty
    because no address was given, which is itself a signal. RISK-R09."""
    frame = load("holdout")
    missing = frame["billing_country_matches_card"].isna()
    assert missing.any(), "the dataset no longer exercises this path"
    design = design_matrix(frame)
    assert design.loc[missing, "billing_country_matches_card"].isna().all()
    assert (design.loc[missing, "billing_match_missing"] == 1.0).all()
