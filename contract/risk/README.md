# Order-risk contract

The source of truth for the **AI / ML** role family, the way
[`../openapi.yaml`](../openapi.yaml) is for the backend family and
[`../analytics/questions.yaml`](../analytics/questions.yaml) is for the data
family. Everything in here is additive: it does not change the REST surface, the
schema or the seed, and no other family is affected by it.

| File | What it is |
|---|---|
| [`rules.yaml`](./rules.yaml) | The declarations: the dataset, every column and whether it is available at order time, the output format, the metric, the bars, and twelve rules with stable ids. |
| [`data/`](./data/) | The dataset. **Generated** — do not hand-edit, do not regenerate. `MANIFEST.json` carries the sha256 of every file. |

## The task

Support has a review queue and a fixed amount of review capacity. Score every
order so the riskiest ones are at the top of that queue.

The deliverable is a **ranking**, not a decision. No threshold is graded, no
threshold can be tuned, and a thresholded 0/1 flag is not an answer — see
RISK-R06.

## Why this family is graded offline

A backend is graded by calling it over HTTP; a web slot by driving a browser; a
data slot by comparing result sets. The analogue here would be "deploy the model
and watch the fraud rate", which is not a measurement anyone can take in an
afternoon, is not reproducible, and is not actually how a model is reviewed
before it ships.

So this family is graded on **predictions over a withheld holdout**, offline and
deterministically. `make run` trains on `train.csv`, predicts, and writes CSV
files. The grader reads those files and nothing else — it never imports the
candidate's code, never calls a hosted model, and needs no network and no GPU.
A full graded run is seconds.

The interesting failures in this work are **methodological, not algorithmic**.
Anybody can fit a gradient-booster. The rules below are the things that separate
a model that works in production from one that scored beautifully in a notebook,
and each one is a measurement rather than an opinion.

## The dataset

`contract/seed/` gives every run the same 5 events, 50 buyer accounts, 2,230
priced seats and 3 discount codes. `contract/analytics/fixture.sql` adds a
transaction history of 14 orders. Fourteen orders at a 4% fraud rate is zero or
one positive case: there is nothing to learn and no metric to compute.

So the dataset starts from the product's own world — those events, those
currencies, those per-section seat prices, those discount codes, that fee
formula, those buyers, and those fourteen real orders, which appear in `train`
with their actual money — and extends it to 9,000 orders across four months. The
money obeys `contract/schema.sql`'s pricing rules on every row, which is the
reason the dataset is generated and not typed in: nine thousand hand-maintained
rows is how a fixture quietly stops agreeing with the contract it illustrates.

The split is **temporal**, at `2026-08-01T00:00:00Z`. Fraud is adversarial and
non-stationary; a random split lets a model see a buyer's later behaviour while
predicting their earlier orders, which flatters it and is not how it would be
evaluated in production.

```
train.csv           6,734 rows   features + is_fraud      fit on this
holdout.csv         2,266 rows   features only            graded; labels withheld
holdout_masked.csv  2,266 rows   features only, post-review columns emptied
holdout_shard.csv     756 rows   every third row of holdout.csv
```

The last two are not extra work for its own sake. They are how two of the rules
below stop being promises and become measurements — see RISK-R05 and RISK-R08.

The holdout labels are withheld; everything else in `contract/risk/` is
published on purpose. You need the columns, the rules, the metric and the bars,
not the answer sheet.

## The output

`make run` reads `PREDICTIONS_DIR` from the environment — **no default**, because
a default is how a grader ends up scoring a stale run — and writes:

```
$PREDICTIONS_DIR/run1/holdout.csv
$PREDICTIONS_DIR/run1/holdout_masked.csv
$PREDICTIONS_DIR/run1/holdout_shard.csv
$PREDICTIONS_DIR/run2/holdout.csv
$PREDICTIONS_DIR/run2/holdout_masked.csv
$PREDICTIONS_DIR/run2/holdout_shard.csv
```

Each file is `order_id,risk_score`, one row per input order in the input's order,
with the score written as a decimal in `[0, 1]` with exactly six digits after the
point. Six decimals so that determinism is compared as text and has one meaning
rather than a tolerance.

`run1` and `run2` are two independent executions of the whole pipeline — fit and
predict — in two separate operating-system processes. The grader cannot run your
code twice, so you demonstrate determinism by producing two runs and the grader
asserts they agree. `run1` is the run that is scored.

How you produce the files — scikit-learn, a hand-rolled logistic regression,
LightGBM, a rule engine — is entirely up to you. The visible suite is
[`../../conformance/ml/`](../../conformance/ml/).

## The metric, and why it is this one

**Average precision** — the area under the precision-recall curve — over the
holdout, with rows sorted by `risk_score` descending and ties broken by
`order_id` ascending. The bar is **0.40**.

- It is **threshold-free**. Nothing is graded at a cut-off, so no cut-off can be
  tuned and no cut-off can be argued about.
- It is **sensitive to the top of the ranking**, which is the only part of the
  ranking a human queue ever reaches. ROC AUC is reported and floored at 0.80,
  but it is not the bar: at a 4% base rate a model can post an excellent AUC by
  being very good at recognising the 96%, and still hand Support a useless queue.
- It **cannot be cleared by a constant**. 4.41% of the holdout is fraud, and a
  constant score computes to 0.0538 under the declared tie-break. The bar is more
  than seven times that, and `conformance/ml` asserts the gap rather than
  assuming it.

The tie-break rule is declared because it has to be: a model that emits many
identical scores would otherwise get whichever ordering happened to be
favourable.

Two further bars exist because the primary metric alone does not express what
Support needs:

- **precision@100 ≥ 0.30** — of the hundred orders at the top of the queue, at
  least thirty are fraud. This is the number the reporter in the ticket feels.
- **per-event average precision ≥ 0.30** for the two largest events,
  individually. A model that has only learned which event is risky scores well
  overall and fails this.

## The rules, and what each one costs

Each rule has a stable id. The grader names the id when it fails, so a failure
points at a sentence rather than at a number.

### RISK-R01 — Predictions cover exactly the holdout

Every input order, once each, nothing else.

**Why.** A missing row is an order nobody reviewed. A duplicate row is ambiguous.
An extra row means the pipeline scored something it was not given, which usually
means it was handed the wrong file. It is also the cheapest possible check that
the candidate did not quietly train on part of the holdout and predict only the
rest.

### RISK-R02 — Features must be available at order time

Only columns marked `available: order_time` may be used. The three columns marked
`available: post_review` must not be read, imputed, encoded, counted, tested for
nullness, or used to select or weight rows.

**Why.** `chargeback_filed` agrees with the label 99% of the time, because it is
written weeks after the order by the person who established that the order was
fraud. `support_tickets_during_review` is written *during the investigation* —
there is no investigation when the order is placed. `manual_review_outcome` is a
human's conclusion, which is very nearly the label itself.

They are in the dataset because they are in the warehouse. That is exactly how
this mistake happens: somebody selects `*` from the orders table, the model
scores 0.99 offline, and in production every one of those columns is empty for
the orders that matter — so the model ranks the queue at random and nobody can
explain why. This is the single most common way a fraud model fails, and it is
the headline failure this family grades.

**How it is detected.** Not by reading your code. `holdout_masked.csv` is the
same 2,266 orders with those three columns emptied, and RISK-R05 asserts your
scores do not move.

### RISK-R03 — Fit on train only

Every estimated quantity — coefficients, imputation medians, scaler means and
variances, encoder vocabularies, category frequencies, target encodings, feature
selections, hyperparameters — comes from `train.csv`. The holdout files are
inputs to prediction, never inputs to fitting.

**Why.** A pipeline that fits its imputer on "all the data I have" has used the
holdout's distribution, so its offline score is optimistic by an amount nobody
can estimate. The production version of the same code sees one order at a time
and has no distribution to fit to, so it behaves differently from the thing that
was measured. The measurement was of a different program.

**How it is detected.** RISK-R08.

### RISK-R04 — Accuracy is not the metric

**Why.** 95.6% of orders are not fraud. "Never fraud" is 95.6% accurate, has a
perfect false-positive rate, and is worth nothing. Any metric that a constant can
do well on is not a metric for this problem. Average precision is the bar;
accuracy, and any threshold-dependent score, is not graded at all.

### RISK-R05 — Nulling the post-review columns must not change your scores

Your `holdout_masked.csv` predictions must agree with your `holdout.csv`
predictions: rank correlation at least 0.98 and maximum absolute difference at
most 0.02 in the visible suite. **Exact** equality is also assessed at review.

**Why.** This is RISK-R02 turned into arithmetic. A model that never looks at a
post-review column produces byte-identical output for the two files, trivially
and without trying. A model that leans on `chargeback_filed` produces a
completely different queue the moment that column is empty — which is precisely
what happens the day it is deployed. The two files are the offline simulation of
that day.

The consequence in operations: the model that scored 0.99 in testing catches
nothing live, and the only visible symptom is that the review queue looks random.

### RISK-R06 — A score, not a decision

`risk_score` is continuous, in `[0, 1]`, takes at least 200 distinct values
across the holdout, and no single value covers more than 25% of rows.

**Why.** Support works down a queue. A 0/1 flag gives them a bag of orders with
no order in it, and a model that has already chosen the cut-off has taken a
business decision — how much review capacity to spend — that is not the model's
to take. Collapsing to a flag also destroys the metric: average precision of a
binary vector is one point on the curve, which is why a model that thresholds
tends to fail RISK-R04's bar as well.

### RISK-R07 — Determinism

`run1` and `run2` must be byte-identical across all three files.

**Why.** A model you cannot reproduce is a model you cannot debug, cannot review,
and cannot roll back to. When the queue looks wrong on a Tuesday, the first
question is "what did we ship", and an unpinned seed means there is no answer.
It is also the cheapest possible evidence that the pipeline does not depend on
something it should not — the clock, the thread count, an iteration order.

### RISK-R08 — Scoring one order must not depend on the others

`holdout_shard.csv` is every third row of `holdout.csv`. The score you give an
order in the shard must equal the score you gave it in the full holdout.

**Why.** In production, orders arrive one at a time. Anything fitted, pooled or
normalised across the batch being scored — an imputer, a scaler, a category
frequency, a target encoding, a quantile cut-off — gives an order a different
score depending on which other orders happen to be in the batch with it. That is
not a model; it is a model plus an accident. The shard is a second batch
containing a third of the same orders, so it costs nothing to produce and it
makes the property measurable.

This is also the honest detector for the two mistakes that are otherwise
invisible from outside: fitting preprocessing on train *and* the scoring frame,
and computing a target or frequency encoding over the whole dataset. Both change
the score of an unchanged order, and the shard sees it.

### RISK-R09 — Missing is data

Several order-time columns are nullable, and they are not missing at random.
Nothing forbids dropping rows; the metric charges for it.

**Why.** `card_country` is empty when the acquirer returned no issuing country,
`billing_country_matches_card` when no address was given,
`hold_to_checkout_seconds` when the session was resumed — and all three happen
far more often on abusive traffic. A `dropna()` in the cleaning step looks like
hygiene and is in fact a filter that deletes most of the positive class. The
model then never sees the cases it exists to catch. Missingness itself is a
perfectly good order-time feature.

### RISK-R10 — No network, no hosted model, no clock

Training and scoring run offline. Nothing may depend on the wall clock, the
hostname, the locale, the thread count, or any environment variable other than
`PREDICTIONS_DIR`.

**Why.** Partly RISK-R07: any of those makes two runs disagree on another
machine. Partly the grading surface: a graded exercise that calls a hosted model
is not reproducible, not offline, and not free, and it grades the vendor as much
as the candidate — see
[`../../slots/ai-ml-engineer/_SPEC.md`](../../slots/ai-ml-engineer/_SPEC.md) for why the sibling
LLM slot is deliberately not built.

### RISK-R11 — Integer money stays integer

Derive what you like from the money columns — ratios are fine, float features are
fine — but do not round-trip a money value through a float and write it back as
money.

**Why.** It is the product's rule everywhere, not a rule of this family. See
`contract/openapi.yaml`.

### RISK-R12 — The dataset is fixed

Do not edit `data/`, do not regenerate it, do not add rows to `train.csv`.

**Why.** The bars in `rules.yaml` were measured against exactly these files. The
grader checks them against `MANIFEST.json`'s sha256 digests before it scores
anything, so a drifted dataset fails loudly instead of quietly making every
declared threshold a guess.

## The traps, stated plainly

These are the rules above, read as the mistakes they exist to catch. A model that
makes any of them still trains, still produces a number, and the number still
looks like a good one.

| Trap | Where it bites | Detected by |
|---|---|---|
| **Label leakage** | A post-review column is a near-perfect proxy for the label and is empty in production. | RISK-R05 (masked holdout), RISK-R02 |
| **Train/test contamination** | Preprocessing fitted on the scoring frame; the offline score is optimistic by an unknown amount. | RISK-R08 (shard), RISK-R03 |
| **Whole-dataset encoding** | A target or frequency encoding computed over everything, so a row's score depends on its neighbours. | RISK-R08 (shard) |
| **Non-determinism** | An unpinned seed: nobody can say what was shipped. | RISK-R07 (two runs) |
| **Class imbalance** | Optimising accuracy, or predicting the majority class. | RISK-R04, the metric itself |
| **Thresholding too early** | A flag instead of a score; a cut-off chosen on the data being scored. | RISK-R06, RISK-R08 |
| **Cleaning away the positives** | `dropna()` on columns that are missing because the order was fraudulent. | RISK-R09, the metric |
| **One spurious group** | A model that has learned which event is risky and nothing else. | per-event average precision |
