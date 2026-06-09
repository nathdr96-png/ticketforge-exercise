# conformance/ml — the AI/ML grading suite

Grades an order-risk implementation against
[`contract/risk/`](../../contract/risk/). Black-box, like every other suite here:
it reads the CSV files the implementation wrote and nothing else.

```bash
cd slots/ai-ml-engineer/fraud-scoring && make install && make run   # writes predictions/
cd ../../../conformance/ml && npm install
PREDICTIONS_DIR=../../slots/ai-ml-engineer/fraud-scoring/predictions npx vitest run
```

`PREDICTIONS_DIR` has **no default**. A default is how a grader ends up scoring
last week's run and reporting it as this week's — the same reason `BASE_URL`,
`RESULTS_DIR` and `RENDER_DIR` have none in the other suites.

## What it never does

- **It never imports the candidate's code.** Not a single Python process is
  started. An implementation in R, Julia or Rust is graded by exactly the same
  bar as any other.
- **It never calls a model.** No network, no hosted API, no credentials, no GPU.
- **It never trains anything.** The metric, including average precision and ROC
  AUC, is implemented in `contract.ts` in TypeScript, over the predictions file.

Total runtime is a few seconds.

## The 19 visible tests

| Group | Grades | Rules |
|---|---|---|
| the dataset the bars were measured against | `contract/risk/data/` still matches the sha256 digests in its manifest | RISK-R12 |
| the output contract | all six files exist; each covers exactly its input's order ids, once each, in order; every score is a six-decimal value in `[0, 1]` | RISK-R01, RISK-R06 |
| determinism | `run1` and `run2` agree on all three files | RISK-R07 |
| a score, not a decision | at least 200 distinct scores, no value covering more than a quarter of the holdout | RISK-R06 |
| label leakage | emptying the post-review columns does not reorder the queue (Spearman ≥ 0.98, max Δ ≤ 0.02) | RISK-R02, RISK-R05 |
| train/test discipline | a third of the holdout scores the same as the whole holdout; the shard is the declared subset | RISK-R03, RISK-R08 |
| the metric | average precision ≥ 0.40 on the holdout **and** on the masked holdout; ROC AUC ≥ 0.80; at least 3× a constant; precision@100 above twice the base rate | RISK-R04 |
| the holdout is the holdout | no label column exists in any input file | RISK-R03 |

The bars are read out of `contract/risk/rules.yaml` rather than written here, so a
bar that moves in the contract moves in the grader.

## The leakage check needs no labels

This is the part worth understanding before changing anything.

`holdout_masked.csv` is the same 2,266 orders as `holdout.csv` with the three
`available: post_review` columns emptied. It is the offline simulation of
production, where `chargeback_filed` is empty for every order Support is actually
triaging.

A model that never reads those columns produces **identical** predictions for the
two files — trivially, without trying. A model that leans on `chargeback_filed`
produces a completely different queue. So comparing the two prediction files
detects label leakage **without knowing a single label**, which is why the
visible suite can grade the most important rule in this family without shipping
the answer sheet.

The same trick, one level up, is `holdout_shard.csv`: every third holdout row.
Comparing an order's score in the shard to its score in the full holdout detects
anything fitted, pooled or normalised across the batch being scored — again with
no labels.

## Withheld labels

The holdout labels are withheld, so when you run this suite the metric tests
fail with a message saying so. Everything else in the suite still runs, because
the structural, determinism, leakage and shard checks need no labels. Some
properties are also assessed at review — for example the strict, exact-equality
forms of RISK-R05 and RISK-R08, and the operational bars from
`metric.operational` in `contract/risk/rules.yaml`.

## A candidate's own feedback loop

A candidate has no holdout labels, so they cannot run the metric tests. That is
deliberate, and it is why the slot ships its own measurement:

```bash
cd slots/ai-ml-engineer/fraud-scoring
make test                # includes the bars, on a temporal split of train.csv
python -m risk --report  # prints average precision, ROC AUC, precision@100
```

Both split `train.csv` by date and measure on the later part, which is the same
discipline the contract's own split uses.
