/**
 * Shared helpers for the data/analytics conformance suite.
 *
 * Black-box and stack-agnostic by construction: nothing here knows how the
 * answers were produced. The only interface is a directory of
 * `<question_id>.json` files, described in contract/analytics/README.md, so a
 * SQL slot, a dbt project and a pandas script are all graded by the same bar.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export interface ColumnSpec {
  name: string;
  type: "text" | "integer" | "date" | "boolean";
  nullable?: boolean;
  note?: string;
}

export interface QuestionSpec {
  id: string;
  title: string;
  question: string;
  grain: string;
  columns: ColumnSpec[];
  order_by: string[];
  rules: string[];
}

export type Row = Record<string, unknown>;

export function loadContract(): QuestionSpec[] {
  const file = path.join(REPO_ROOT, "contract", "analytics", "questions.yaml");
  const doc = parseYaml(fs.readFileSync(file, "utf8")) as { questions: QuestionSpec[] };
  if (!doc?.questions?.length) throw new Error(`no questions in ${file}`);
  return doc.questions;
}

export function resultsDir(): string {
  const raw = process.env.RESULTS_DIR;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "RESULTS_DIR is not set. The suite grades the result files an implementation " +
        "wrote; it does not run anything itself. See conformance/data/README.md."
    );
  }
  return path.resolve(raw);
}

export function readResult(id: string): Row[] {
  const file = path.join(resultsDir(), `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `no answer for ${id}: expected ${file}. Every question in ` +
        `contract/analytics/questions.yaml must produce a result file.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${id}: result file is not valid JSON (${(err as Error).message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${id}: result file must be a JSON array of row objects`);
  }
  return parsed as Row[];
}

export function readExpected(dir: string, id: string): Row[] {
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing expected fixture ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
}

/**
 * Integer columns are compared as integers, exactly.
 *
 * A Postgres `bigint` arrives over most drivers as a string, and through others
 * as a number, so both spellings are accepted — but anything that is not a whole
 * number is a failure rather than something to round. Money in this repo is
 * integer minor units and there is deliberately no tolerance: a report that is
 * "nearly" right is a report Finance cannot use.
 */
export function asInt(value: unknown, where: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`${where}: ${value} is not an integer`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`${where}: ${JSON.stringify(value)} is not an integer`);
}

function normalise(column: ColumnSpec, value: unknown, where: string): unknown {
  if (value === null || value === undefined) {
    if (column.nullable) return null;
    throw new Error(`${where}: ${column.name} is null, and the contract does not allow it`);
  }
  switch (column.type) {
    case "integer":
      return asInt(value, `${where}.${column.name}`).toString();
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "t") return true;
      if (value === "false" || value === "f") return false;
      throw new Error(`${where}.${column.name}: ${JSON.stringify(value)} is not a boolean`);
    case "date": {
      const s = String(value);
      // Accept a full timestamp only if it is midnight UTC; the column is a day.
      const m = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z?)?$/.exec(s);
      if (!m) {
        throw new Error(
          `${where}.${column.name}: ${JSON.stringify(value)} is not a YYYY-MM-DD UTC date`
        );
      }
      return m[1];
    }
    default:
      return String(value);
  }
}

/** Column names present in the answer but not in the contract, and vice versa. */
export function columnDiff(spec: QuestionSpec, row: Row): { missing: string[]; extra: string[] } {
  const declared = new Set(spec.columns.map((c) => c.name));
  const present = new Set(Object.keys(row));
  return {
    missing: [...declared].filter((c) => !present.has(c)),
    extra: [...present].filter((c) => !declared.has(c)),
  };
}

/**
 * Compare an answer to the expected rows, position by position.
 *
 * Order-aware on purpose: every question in the contract declares an ORDER BY,
 * and "the right rows in the wrong order" is a different answer — it is what a
 * missing window-function partition or a forgotten tiebreak looks like.
 */
export function diffRows(spec: QuestionSpec, got: Row[], want: Row[]): string[] {
  const problems: string[] = [];
  const n = Math.min(got.length, want.length);
  for (let i = 0; i < n; i++) {
    const where = `${spec.id} row ${i}`;
    const { missing, extra } = columnDiff(spec, got[i]);
    if (missing.length) problems.push(`${where}: missing column(s) ${missing.join(", ")}`);
    if (extra.length) problems.push(`${where}: unexpected column(s) ${extra.join(", ")}`);
    if (missing.length || extra.length) continue;
    for (const column of spec.columns) {
      let a: unknown;
      let b: unknown;
      try {
        a = normalise(column, got[i][column.name], where);
        b = normalise(column, want[i][column.name], `expected ${where}`);
      } catch (err) {
        problems.push((err as Error).message);
        continue;
      }
      if (a !== b) {
        problems.push(
          `${where}: ${column.name} is ${JSON.stringify(got[i][column.name])}, ` +
            `expected ${JSON.stringify(want[i][column.name])}`
        );
      }
    }
  }
  if (got.length !== want.length) {
    problems.push(
      `${spec.id}: returned ${got.length} row(s), the contract's answer has ${want.length}` +
        (got.length > want.length
          ? ` — extra row(s) from ${JSON.stringify(got[n] ?? null)}`
          : ` — first missing row is ${JSON.stringify(want[n] ?? null)}`)
    );
  }
  return problems;
}

/** Order-aware check that the rows follow the contract's declared ordering. */
export function orderProblems(spec: QuestionSpec, rows: Row[]): string[] {
  const keys = spec.order_by.map((clause) => {
    const parts = clause.trim().split(/\s+/);
    return {
      column: parts[0],
      desc: parts.includes("DESC"),
      nullsLast: clause.includes("NULLS LAST"),
    };
  });
  const problems: string[] = [];
  const typeOf = new Map(spec.columns.map((c) => [c.name, c.type]));

  const cmp = (a: Row, b: Row): number => {
    for (const key of keys) {
      const av = a[key.column];
      const bv = b[key.column];
      if (av === null && bv === null) continue;
      if (av === null) return key.nullsLast ? 1 : -1;
      if (bv === null) return key.nullsLast ? -1 : 1;
      let d: number;
      if (typeOf.get(key.column) === "integer") {
        const x = asInt(av, `${spec.id}.${key.column}`);
        const y = asInt(bv, `${spec.id}.${key.column}`);
        d = x < y ? -1 : x > y ? 1 : 0;
      } else {
        const x = String(av);
        const y = String(bv);
        d = x < y ? -1 : x > y ? 1 : 0;
      }
      if (d !== 0) return key.desc ? -d : d;
    }
    return 0;
  };

  for (let i = 1; i < rows.length; i++) {
    if (cmp(rows[i - 1], rows[i]) > 0) {
      problems.push(
        `${spec.id}: rows ${i - 1} and ${i} are out of the required order ` +
          `(${spec.order_by.join(", ")})`
      );
      break;
    }
  }
  return problems;
}
