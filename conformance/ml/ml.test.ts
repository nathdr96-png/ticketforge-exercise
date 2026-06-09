import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  DATA_DIR,
  INPUT_FILES,
  MANIFEST,
  RUNS,
  SCORE_DECIMALS,
  alignLabels,
  averagePrecision,
  bar,
  datasetRows,
  predictionFile,
  predictionsDir,
  precisionAtK,
  readPredictions,
  rocAuc,
  sha256,
  spearman,
} from "./contract";

/**
 * The AI/ML conformance suite — order risk scoring.
 *
 * Black-box, like every other suite here: it reads the CSV files an
 * implementation wrote and nothing else. It never imports the candidate's code,
 * never calls a hosted model, needs no network, no database and no GPU, and
 * takes about a second.
 *
 *   PREDICTIONS_DIR=../../slots/ai-ml-engineer/fraud-scoring/predictions npx vitest run
 *
 * The contract is contract/risk/ — rules.yaml for the declarations and the bars,
 * README.md for what each rule costs in production. Every test below names the
 * rule it is grading, so a failure points at a sentence rather than a number.
 *
 * Where a rule is an equality (RISK-R05, RISK-R07, RISK-R08), the checks here
 * allow a small tolerance; the rule itself does not.
 */

function expectedIds(name: string): string[] {
  return datasetRows(name).map((r) => r.order_id);
}

describe("ml: the dataset the bars were measured against", () => {
  it("RISK-R12 contract/risk/data/ matches its committed digests", () => {
    const drift: string[] = [];
    for (const [name, want] of Object.entries(MANIFEST.files as Record<string, any>)) {
      if (want._note) continue; // an annotated entry, not a file in contract/risk/data/
      const file = path.join(DATA_DIR, name);
      expect(fs.existsSync(file), `${name} is missing from contract/risk/data/`).toBe(true);
      const got = sha256(file);
      if (got !== want.sha256) drift.push(`${name}: ${got} != ${want.sha256}`);
      const rows = datasetRows(name.replace(/\.csv$/, "")).length;
      if (rows !== want.rows) drift.push(`${name}: ${rows} rows, manifest says ${want.rows}`);
    }
    expect(
      drift,
      "the dataset has drifted from the one the declared bars were measured against"
    ).toEqual([]);
  });
});

describe("ml: the output contract", () => {
  it("writes every file the contract declares", () => {
    const missing: string[] = [];
    for (const run of RUNS) {
      for (const name of INPUT_FILES) {
        const file = predictionFile(run, name);
        if (!fs.existsSync(file)) missing.push(path.relative(predictionsDir(), file));
      }
    }
    expect(
      missing,
      `missing prediction files under ${predictionsDir()} — see contract/risk/rules.yaml, output.layout`
    ).toEqual([]);
  });

  it.each(INPUT_FILES)(
    "RISK-R01 run1/%s.csv covers exactly its input, once each, in order",
    (name) => {
      const got = readPredictions("run1", name).ids;
      const want = expectedIds(name);
      const extra = got.filter((id) => !new Set(want).has(id));
      const dupes = got.filter((id, i) => got.indexOf(id) !== i);
      const absent = want.filter((id) => !new Set(got).has(id));
      expect({ extra: extra.slice(0, 5), dupes: dupes.slice(0, 5), absent: absent.slice(0, 5) }).toEqual({
        extra: [],
        dupes: [],
        absent: [],
      });
      // Order too: the contract declares the input's order, which is what makes
      // two runs comparable as text.
      expect(got).toEqual(want);
    }
  );

  it("RISK-R06 every score is a decimal in [0, 1] with six places", () => {
    const problems: string[] = [];
    for (const run of RUNS) {
      for (const name of INPUT_FILES) {
        const { text, scores, ids } = readPredictions(run, name);
        text.forEach((raw, i) => {
          if (!/^(0|1)\.\d{6}$/.test(raw)) {
            problems.push(`${run}/${name}.csv ${ids[i]}: ${JSON.stringify(raw)}`);
          } else if (!(scores[i] >= 0 && scores[i] <= 1)) {
            problems.push(`${run}/${name}.csv ${ids[i]}: ${raw} is outside [0, 1]`);
          }
        });
      }
    }
    expect(problems.slice(0, 10), `${problems.length} malformed scores`).toEqual([]);
  });
});

describe("ml: determinism", () => {
  it.each(INPUT_FILES)("RISK-R07 run1 and run2 agree on %s", (name) => {
    const a = readPredictions("run1", name);
    const b = readPredictions("run2", name);
    expect(b.ids).toEqual(a.ids);
    const differing = a.text
      .map((t, i) => (t === b.text[i] ? null : `${a.ids[i]}: ${t} vs ${b.text[i]}`))
      .filter((x): x is string => x !== null);
    expect(
      differing.slice(0, 10),
      `${differing.length} of ${a.ids.length} scores differ between two runs of the ` +
        "same pipeline — something in it is not pinned (RISK-R07)"
    ).toEqual([]);
  });
});

describe("ml: a score, not a decision", () => {
  it("RISK-R06 the holdout scores are a distribution", () => {
    const { text } = readPredictions("run1", "holdout");
    const counts = new Map<string, number>();
    for (const t of text) counts.set(t, (counts.get(t) ?? 0) + 1);
    const distinct = counts.size;
    const biggest = Math.max(...counts.values()) / text.length;
    expect(
      distinct,
      `only ${distinct} distinct scores across ${text.length} orders — a ranking needs more ` +
        "resolution than that, and a thresholded flag is not a score (RISK-R06)"
    ).toBeGreaterThanOrEqual(200);
    expect(
      biggest,
      `one score value covers ${(biggest * 100).toFixed(1)}% of the holdout (RISK-R06)`
    ).toBeLessThanOrEqual(0.25);
  });
});

describe("ml: label leakage", () => {
  /**
   * holdout_masked.csv is the same 2,266 orders with the three post-review
   * columns emptied — the offline simulation of production, where those columns
   * are empty for every order that matters.
   *
   * No labels are needed for this: a model that never read them produces
   * identical output for the two files, and a model that leaned on
   * `chargeback_filed` produces a different queue. The tolerance here is
   * deliberate; the grader asserts exact equality.
   */
  it("RISK-R05 emptying the post-review columns does not reorder the queue", () => {
    const full = readPredictions("run1", "holdout");
    const masked = readPredictions("run1", "holdout_masked");
    expect(masked.ids).toEqual(full.ids);

    const rho = spearman(full.scores, masked.scores);
    const maxDelta = Math.max(...full.scores.map((s, i) => Math.abs(s - masked.scores[i])));
    const moved = full.scores.filter((s, i) => Math.abs(s - masked.scores[i]) > 0.02).length;

    expect(
      rho,
      `rank correlation between the full and masked holdout is ${rho.toFixed(4)}: the model's ` +
        "ranking depends on columns that are only populated after a fraud review, and those " +
        "columns are empty in production (RISK-R02/RISK-R05)"
    ).toBeGreaterThanOrEqual(0.98);
    expect(
      maxDelta,
      `${moved} orders move by more than 0.02 when the post-review columns are emptied ` +
        `(largest ${maxDelta.toFixed(4)}) — RISK-R05`
    ).toBeLessThanOrEqual(0.02);
  });
});

describe("ml: train/test discipline", () => {
  /**
   * holdout_shard.csv is every third holdout row. In production orders arrive one
   * at a time, so an order's score must not depend on which other orders happen
   * to be in the batch with it. Anything fitted, pooled or normalised across the
   * scoring frame — an imputer, a scaler, a category frequency, a target
   * encoding, a quantile cut-off — changes when the batch changes, and this sees
   * it.
   */
  it("RISK-R08 a third of the holdout scores the same as the whole holdout", () => {
    const full = readPredictions("run1", "holdout");
    const shard = readPredictions("run1", "holdout_shard");
    const byId = new Map(full.ids.map((id, i) => [id, full.scores[i]]));
    const moved = shard.ids
      .map((id, i) => {
        const whole = byId.get(id);
        if (whole === undefined) return `${id} is not in the holdout`;
        const delta = Math.abs(whole - shard.scores[i]);
        return delta > 1e-6 ? `${id}: ${whole} in the holdout, ${shard.scores[i]} in the shard` : null;
      })
      .filter((x): x is string => x !== null);
    expect(
      moved.slice(0, 10),
      `${moved.length} of ${shard.ids.length} orders got a different score when scored as part ` +
        "of a smaller batch — something in the pipeline is fitted or pooled over the rows " +
        "being scored (RISK-R03/RISK-R08)"
    ).toEqual([]);
  });

  it("RISK-R08 the shard is the subset of the holdout the contract declares", () => {
    const every = Number(MANIFEST.shard_every);
    const want = expectedIds("holdout").filter((_, i) => i % every === 0);
    expect(expectedIds("holdout_shard")).toEqual(want);
  });
});

describe("ml: the metric", () => {
  /**
   * Read inside each test, never at describe time.
   *
   * A `describe` body runs at COLLECTION time, so a throw there takes the whole
   * file down and vitest reports zero tests — which a defect→test map reads as
   * "this defect breaks nothing". That is exactly backwards for a slot whose
   * `make run` can fail: the one case where the suite most needs to say
   * something is the case where there is nothing to read.
   */
  const holdout = () => {
    const { ids, scores } = readPredictions("run1", "holdout");
    return { ids, scores, y: alignLabels(ids) };
  };

  it("average precision on the holdout clears the declared bar", () => {
    const { ids, scores, y } = holdout();
    const ap = averagePrecision(ids, scores, y);
    expect(
      ap,
      `average precision ${ap.toFixed(4)} against a declared minimum of ` +
        `${bar("average_precision_holdout")} (contract/risk/rules.yaml, metric.bars)`
    ).toBeGreaterThanOrEqual(bar("average_precision_holdout"));
  });

  it("average precision survives the masked holdout", () => {
    const masked = readPredictions("run1", "holdout_masked");
    const ap = averagePrecision(masked.ids, masked.scores, alignLabels(masked.ids));
    expect(
      ap,
      `average precision ${ap.toFixed(4)} with the post-review columns emptied, against a ` +
        `declared minimum of ${bar("average_precision_holdout_masked")}. This is the number ` +
        "the model would post in production (RISK-R02)"
    ).toBeGreaterThanOrEqual(bar("average_precision_holdout_masked"));
  });

  it("roc auc clears its floor", () => {
    const { scores, y } = holdout();
    const auc = rocAuc(scores, y);
    expect(auc, `roc auc ${auc.toFixed(4)}`).toBeGreaterThanOrEqual(bar("roc_auc_holdout"));
  });

  it("RISK-R04 beats a constant by a wide margin", () => {
    /**
     * Fraud is 4.4% of the holdout, so "never fraud" is 95.6% accurate. Under the
     * contract's tie-break a constant score computes to 0.0538 average precision.
     * The point of this test is not that a constant fails the bar — it does — but
     * that the gap is asserted here rather than assumed, so a dataset whose base
     * rate drifted could not make the bar reachable by doing nothing.
     */
    const { ids, scores, y } = holdout();
    const constant = averagePrecision(ids, ids.map(() => 0), y);
    const ap = averagePrecision(ids, scores, y);
    expect(constant).toBeLessThan(bar("average_precision_holdout"));
    expect(
      ap / constant,
      `the model scores ${ap.toFixed(4)} and a constant scores ${constant.toFixed(4)}`
    ).toBeGreaterThanOrEqual(3);
  });

  it("the top of Support's queue is mostly fraud", () => {
    const { ids, scores, y } = holdout();
    const p = precisionAtK(ids, scores, y, 100);
    const prevalence = y.reduce((a, b) => a + b, 0) / y.length;
    expect(
      p,
      `precision@100 is ${p.toFixed(4)} against a base rate of ${prevalence.toFixed(4)} — of the ` +
        "hundred orders at the top of the review queue, that is the fraction that is really fraud"
    ).toBeGreaterThan(prevalence * 2);
  });
});

describe("ml: the holdout is the holdout", () => {
  it("RISK-R03 the holdout carries no labels for anyone to have fitted on", () => {
    const header = Object.keys(datasetRows("holdout")[0]);
    expect(header).not.toContain("is_fraud");
    for (const name of INPUT_FILES) {
      expect(Object.keys(datasetRows(name)[0])).not.toContain("is_fraud");
    }
  });
});
