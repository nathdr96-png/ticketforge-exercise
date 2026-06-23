# ml/fraud-scoring

Scores every TicketForge order for the probability that it is fraudulent, so that
Support reviews the riskiest orders first. Python 3.12, scikit-learn, a
slot-local `.venv`, no server and no database.

The contract is [`contract/risk/`](../../../contract/risk/) —
`rules.yaml` for the declarations and the bars, `README.md` for what each rule
costs in production. The grader is
[`conformance/ml/`](../../../conformance/ml/).

## Setup

```bash
make install     # python3 -m venv .venv + three pinned wheels
make run         # train, predict, write predictions/run1 and predictions/run2
make test        # the slot's own tests, including the contract's bars
make lint        # hygiene: no clock, environment or network on the pipeline
```

No Postgres, no Redis, no network, no GPU. `make run` takes about 13 seconds for
both runs.

`PREDICTIONS_DIR` defaults to `./predictions` here so that a human can type
`make run`; the grader always passes it explicitly, and
[`conformance/ml`](../../../conformance/ml/) has no default for it at all.

## Measured

On the committed dataset, with `make run` and
`PREDICTIONS_DIR=./predictions npx vitest run` in `conformance/ml`:

| | measured | declared bar |
|---|---|---|
| average precision, holdout | **0.6734** | 0.40 |
| average precision, masked holdout | **0.6734** (identical) | 0.40 |
| ROC AUC, holdout | 0.9594 | 0.80 |
| precision@100 | 0.6200 | 0.30 |
| average precision, `event_arena_2000` | 0.6430 | 0.30 |
| average precision, `event_club_100` | 0.7297 | 0.30 |
| a constant score, for comparison | 0.0538 | — |
| distinct scores across 2,266 orders | 2,109 | ≥ 200 |
| `run1` vs `run2` | identical | identical |
| shard vs holdout | identical | identical |

The masked figure being *identical* rather than merely close is the point: this
model does not read a post-review column, so emptying those columns cannot move
it. See RISK-R05.

## Layout

```
risk/contract.py   what contract/risk/ says — column availability, bars, digests
risk/features.py   the design matrix: which columns, and what is derived
risk/model.py      preprocessing fitted on train, HistGradientBoosting on top
risk/metrics.py    average precision / ROC AUC / precision@k, by hand
risk/pipeline.py   one run: fit, score the three input files, write CSV
risk/lint.py       `make lint`: static check for RISK-R10
risk/__main__.py   `python -m risk --out DIR` and `--report`
tests/             pytest: the contract, the metric, the model, the run
predictions/       generated, git-ignored
```

## Why `make run` runs the pipeline twice

RISK-R07 says two runs must produce identical predictions. The grader cannot
execute this code twice — it reads files and never imports the slot — so the
property has to be demonstrated from the inside and asserted from the outside:
`make run` executes `python -m risk` twice, in two separate processes, into
`run1/` and `run2/`, and the suite compares them. `run1` is the run that is
scored.

That is also why `risk/pipeline.py` writes the CSV by hand rather than with
`DataFrame.to_csv`: the six-decimal formatting is this file's decision, so
determinism cannot become a property of the pandas release that happens to be
installed.

## The four decisions worth arguing about

**1. Nothing is in a `sklearn.pipeline.Pipeline` end to end.**
`risk/model.py` holds the fitted imputer-plus-scaler, the fitted encoder and the
estimator as three objects, and `Model.matrix()` calls `transform` on the first
two. A single `Pipeline` would be shorter. It would also make the difference
between `transform` and `fit_transform` on the scoring path a one-character edit
with no visible consequence — and that edit is RISK-R03 and RISK-R08 broken at a
stroke. Written out, "fit on train, then only ever transform" is something a
reviewer can see.

**2. `buyer_id` is not a feature.**
950 levels, 900 of them near-singletons. One-hot encoding it is noise;
target-encoding it is a RISK-R08 violation waiting to happen, because the
encoding would be a statistic over rows and an order's score would then depend on
which other orders were in the batch. What matters about the buyer is already in
`buyer_account_age_days`, `buyer_prior_paid_orders` and the velocity columns.

**3. Rows with missing values are kept, and missingness is a feature.**
`card_country`, `billing_country_matches_card` and `hold_to_checkout_seconds` are
all empty far more often on fraudulent orders — no issuing country came back, no
address was given, the session was resumed. A `dropna()` in `clean()` would look
like hygiene and would in fact take the training set from 6,734 rows to 5,225 —
a fifth, which nobody blinks at — while taking the positives from 394 to 34.
Average precision falls from 0.6734 to 0.2534, measured. So the nulls stay, and
`card_country_missing`, `hold_seconds_missing`, `billing_match_missing` and
`missing_order_time_columns` go into the design matrix. RISK-R09.

**4. Class weight, not resampling.**
Positives are 5.9% of train. `sample_weight` corrects the imbalance without
changing which rows exist; a resample would make the measured metric depend on
the resampling draw, which is a determinism problem dressed up as a modelling
choice.

## The metric is implemented twice on purpose

`risk/metrics.py` implements average precision, ROC AUC and precision@k in
numpy. `conformance/ml/contract.ts` implements the same definitions in
TypeScript. Neither imports the other, and `tests/test_metrics.py` checks this
one against `sklearn.metrics` and against hand-computed examples.

Two independent implementations that agree are worth more than one used twice: if
the slot and the grader ever disagree about a number, that is a bug somebody can
find, rather than a disagreement about what the metric means.

## `make lint` is not a style checker

It strips comments and string literals from `risk/*.py` and checks one thing:
that the pipeline reads no clock, no environment variable and no network
(RISK-R10), so that two runs on two machines score the same rows identically.

Whether the model is *sound* is not something a lint can tell you — that is a
question about the data and the method, which
[`contract/risk/rules.yaml`](../../../contract/risk/rules.yaml) states in full.
The lint is deliberately *not* wired into `make run`: a wrong model should produce a bad
score and be caught by the grader, not crash. A run that crashes is a tooling
failure and tells nobody anything about the model.
