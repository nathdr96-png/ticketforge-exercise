/**
 * Shared reading and scoring for the AI/ML grading suite.
 *
 * The metric is implemented here, in TypeScript, over the predictions file. It is
 * deliberately NOT imported from the candidate's slot and deliberately not a call
 * into scikit-learn: the grader must be able to score a submission written in any
 * language, and it must not be possible to pass by shipping a convenient metric.
 * `slots/ai-ml-engineer/fraud-scoring/risk/metrics.py` is a second, independent
 * implementation of the same definition, and the slot's own tests check the two
 * against sklearn — so a disagreement between them is a bug, not a judgement.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";

/** The repository root, found by looking for the contract rather than counting `..`s. */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "contract", "risk", "rules.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("could not find contract/risk/rules.yaml above " + import.meta.dirname);
}

export const ROOT = repoRoot();
export const RISK_DIR = path.join(ROOT, "contract", "risk");
export const DATA_DIR = path.join(RISK_DIR, "data");

export const RULES = YAML.parse(fs.readFileSync(path.join(RISK_DIR, "rules.yaml"), "utf8"));
export const MANIFEST = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "MANIFEST.json"), "utf8"));

/** The three input files the contract requires predictions for. */
export const INPUT_FILES = ["holdout", "holdout_masked", "holdout_shard"] as const;
export const RUNS = ["run1", "run2"] as const;
export const SCORE_DECIMALS = 6;

/**
 * The predictions directory, from the environment, with NO default.
 *
 * A default is how a grader ends up scoring last week's run and reporting it as
 * this week's. Every other suite in this repository takes its target the same
 * way (`BASE_URL`, `RESULTS_DIR`, `RENDER_DIR`) and for the same reason.
 */
export function predictionsDir(): string {
  const raw = process.env.PREDICTIONS_DIR;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "PREDICTIONS_DIR is not set — these tests grade the prediction files an " +
        "implementation wrote. Run the slot's `make run` first, then point this at " +
        "the directory it wrote (it contains run1/ and run2/)."
    );
  }
  return path.resolve(raw.trim());
}

/** A declared bar out of rules.yaml, by name. Throws rather than defaulting. */
export function bar(name: string): number {
  const bars = RULES.metric.bars ?? {};
  if (name in bars) return Number(bars[name].min);
  const operational = RULES.metric.operational ?? {};
  if (name in operational) return Number(operational[name].min);
  throw new Error(`contract/risk/rules.yaml declares no bar named ${name}`);
}

// ---------------------------------------------------------------------- CSV
export type Row = Record<string, string>;

/** Minimal CSV reader: the dataset is generated and quotes nothing, but a quoted
 * field is handled anyway so a candidate's writer cannot fail here by being
 * correct. */
export function parseCsv(text: string): { header: string[]; rows: Row[] } {
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("empty CSV");
  const header = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    if (cells.length !== header.length) {
      throw new Error(`row has ${cells.length} cells, header has ${header.length}: ${line}`);
    }
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
  return { header, rows };
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else if (c !== "\r") {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function readCsv(file: string): { header: string[]; rows: Row[] } {
  if (!fs.existsSync(file)) throw new Error(`missing file: ${file}`);
  return parseCsv(fs.readFileSync(file, "utf8"));
}

export function datasetRows(name: string): Row[] {
  return readCsv(path.join(DATA_DIR, `${name}.csv`)).rows;
}

// --------------------------------------------------------------- predictions
export interface Predictions {
  ids: string[];
  /** The score exactly as written, for byte-level comparisons. */
  text: string[];
  scores: number[];
}

export function predictionFile(run: string, name: string): string {
  return path.join(predictionsDir(), run, `${name}.csv`);
}

/**
 * Read one predictions file, enforcing only the shape — the header and the two
 * columns. Everything else (coverage, range, determinism) is a named test, so a
 * failure points at a rule instead of at a parser.
 */
export function readPredictions(run: string, name: string): Predictions {
  const { header, rows } = readCsv(predictionFile(run, name));
  if (header.join(",") !== "order_id,risk_score") {
    throw new Error(
      `${run}/${name}.csv header is [${header.join(",")}], the contract declares ` +
        "order_id,risk_score"
    );
  }
  return {
    ids: rows.map((r) => r.order_id),
    text: rows.map((r) => r.risk_score),
    scores: rows.map((r) => Number(r.risk_score)),
  };
}

export function labels(): Map<string, number> {
  const file = path.join(import.meta.dirname, "labels", "holdout_labels.csv");
  if (!fs.existsSync(file)) {
    throw new Error(
      `the withheld holdout labels are not in this checkout (${file}).\n` +
        "The holdout's labels are withheld, so this is expected: the holdout " +
        "metric cannot be computed here. Measure yourself with the slot's `make test` " +
        "or `python -m risk --report`, which split train.csv temporally."
    );
  }
  const { rows } = readCsv(file);
  return new Map(rows.map((r) => [r.order_id, Number(r.is_fraud)]));
}

// -------------------------------------------------------------------- metric
/**
 * Average precision, exactly as `contract/risk/rules.yaml` defines it:
 *
 *     sum_k (R_k - R_{k-1}) * P_k
 *
 * over the ranking, with ties broken by order_id ascending. The step-function
 * form, not an interpolated PR curve: interpolation is optimistic on a rare
 * class, and the contract declares the summation.
 */
export function averagePrecision(ids: string[], scores: number[], y: number[]): number {
  const order = rank(ids, scores);
  const positives = y.reduce((a, b) => a + b, 0);
  if (positives === 0) throw new Error("average precision is undefined with no positives");
  let hits = 0;
  let total = 0;
  order.forEach((idx, i) => {
    if (y[idx] === 1) {
      hits++;
      total += hits / (i + 1);
    }
  });
  return total / positives;
}

/** Mann-Whitney U with mid-ranks, so a model that emits few distinct values
 * does not collect a free half-point on every tie. */
export function rocAuc(scores: number[], y: number[]): number {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b] || a - b);
  const ranks = new Array<number>(scores.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = mid;
    i = j + 1;
  }
  const nPos = y.reduce((a, b) => a + b, 0);
  const nNeg = y.length - nPos;
  if (nPos === 0 || nNeg === 0) throw new Error("ROC AUC is undefined with one class");
  let sum = 0;
  y.forEach((label, k) => {
    if (label === 1) sum += ranks[k];
  });
  return (sum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function precisionAtK(ids: string[], scores: number[], y: number[], k: number): number {
  const order = rank(ids, scores);
  const top = order.slice(0, Math.min(k, order.length));
  return top.reduce((a, idx) => a + y[idx], 0) / top.length;
}

/** Spearman rank correlation. Used to compare two score vectors over the same
 * orders without needing labels at all. */
export function spearman(a: number[], b: number[]): number {
  const ra = midRanks(a);
  const rb = midRanks(b);
  return pearson(ra, rb);
}

function midRanks(values: number[]): number[] {
  const idx = values.map((_, i) => i).sort((x, y) => values[x] - values[y] || x - y);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && values[idx[j + 1]] === values[idx[i]]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = mid;
    i = j + 1;
  }
  return ranks;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/** Positions, sorted by score descending with ties broken by order_id ascending —
 * the contract's tie-break, so a model that emits a handful of distinct values
 * gets one defined answer rather than a favourable one. */
export function rank(ids: string[], scores: number[]): number[] {
  return ids
    .map((_, i) => i)
    .sort((a, b) => scores[b] - scores[a] || (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0));
}

/** Labels aligned to a prediction file's own id order. */
export function alignLabels(ids: string[]): number[] {
  const truth = labels();
  return ids.map((id) => {
    const y = truth.get(id);
    if (y === undefined) throw new Error(`no withheld label for ${id} — not a holdout order`);
    return y;
  });
}

export function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
