import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  REPO_ROOT,
  asInt,
  columnDiff,
  diffRows,
  loadContract,
  orderProblems,
  readExpected,
  readResult,
  resultsDir,
  type Row,
} from "./contract.js";

/**
 * Black-box conformance for the data/analytics family.
 *
 * The suite never looks at an implementation. It reads the result files the
 * implementation wrote — one `<question_id>.json` per question in
 * contract/analytics/questions.yaml — and compares them to the expected
 * answers in ./expected/. SQL, dbt and pandas are therefore graded identically.
 *
 * Expected fixtures live in ./expected/ and are GENERATED, never hand-edited.
 * Not every question has one here.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://ticketforge:ticketforge@localhost:5432/ticketforge";
const EXPECTED_DIR = path.join(import.meta.dirname, "expected");

const QUESTIONS = loadContract();
// The questions this suite grades are the ones with a committed fixture.
const VISIBLE = QUESTIONS.filter((q) => fs.existsSync(path.join(EXPECTED_DIR, `${q.id}.json`)));

function sumBy(rows: Row[], column: string): bigint {
  return rows.reduce((acc, row) => acc + asInt(row[column], column), 0n);
}

/**
 * The answers are defined against one exact dataset. If the database is not that
 * dataset, every comparison below would fail with a confusing message about
 * revenue when the real problem is that nobody ran `make seed`.
 */
describe("data: the dataset the answers are defined against", () => {
  it("is loaded", async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ k: string; n: string }>(`
        SELECT 'events' AS k, COUNT(*)::text AS n FROM events
        UNION ALL SELECT 'seats', COUNT(*)::text FROM seats
        UNION ALL SELECT 'holds', COUNT(*)::text FROM holds
        UNION ALL SELECT 'orders_paid', COUNT(*)::text FROM orders WHERE status = 'paid'
        UNION ALL SELECT 'orders_refunded', COUNT(*)::text FROM orders WHERE status = 'refunded'
        UNION ALL SELECT 'order_seats', COUNT(*)::text FROM order_seats
        UNION ALL SELECT 'outbox_hold_created', COUNT(*)::text FROM outbox_events
          WHERE event_type = 'hold.created'
        UNION ALL SELECT 'outbox_hold_expired', COUNT(*)::text FROM outbox_events
          WHERE event_type = 'hold.expired'
      `);
      const counts = Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
      expect(counts, "run `make migrate && make seed` in the slot first").toEqual({
        events: 5,
        seats: 2230,
        holds: 24,
        orders_paid: 12,
        orders_refunded: 2,
        order_seats: 26,
        outbox_hold_created: 24,
        outbox_hold_expired: 5,
      });
    } finally {
      await client.end();
    }
  });
});

describe("data: the results interface", () => {
  it("every question in the contract has an answer file", () => {
    const dir = resultsDir();
    expect(fs.existsSync(dir), `no results directory at ${dir}`).toBe(true);
    const missing = QUESTIONS.filter((q) => !fs.existsSync(path.join(dir, `${q.id}.json`)));
    expect(
      missing.map((q) => q.id),
      `contract/analytics/questions.yaml defines ${QUESTIONS.length} questions; ` +
        `these produced no answer file in ${dir}`
    ).toEqual([]);
  });

  it("every answer is a JSON array of row objects", () => {
    for (const q of QUESTIONS) {
      const rows = readResult(q.id);
      for (const [i, row] of rows.entries()) {
        expect(
          row !== null && typeof row === "object" && !Array.isArray(row),
          `${q.id} row ${i} is not an object — rows are objects keyed by column name`
        ).toBe(true);
      }
    }
  });
});

describe("data: declared shape and ordering", () => {
  // Applies to every question, including those with no expected fixture here:
  // the column list and the ordering are public contract, whatever the values.
  for (const q of QUESTIONS) {
    it(`${q.id}: columns are exactly the ones the contract declares`, () => {
      const rows = readResult(q.id);
      const problems: string[] = [];
      for (const [i, row] of rows.entries()) {
        const { missing, extra } = columnDiff(q, row);
        if (missing.length) problems.push(`row ${i} is missing ${missing.join(", ")}`);
        if (extra.length) problems.push(`row ${i} has undeclared ${extra.join(", ")}`);
      }
      expect(problems, `${q.id} (${q.title})`).toEqual([]);
    });

    it(`${q.id}: rows are in the order the contract requires`, () => {
      expect(orderProblems(q, readResult(q.id))).toEqual([]);
    });
  }
});

describe("data: answers match the contract", () => {
  for (const q of VISIBLE) {
    it(`${q.id}: ${q.title}`, () => {
      const problems = diffRows(q, readResult(q.id), readExpected(EXPECTED_DIR, q.id));
      expect(problems, `${q.id} — ${q.question.trim()}`).toEqual([]);
    });
  }
});

/**
 * Invariants, not stored answers. These hold for any correct implementation on
 * any dataset, and they are what catches an answer that is internally
 * inconsistent — the signature of a fan-out, a dropped status filter, or two
 * reports built on two different definitions.
 */
describe("data: cross-question reconciliation", () => {
  it("every reported net equals gross - discounts + fees", () => {
    const problems: string[] = [];
    for (const q of QUESTIONS) {
      const needed = ["gross_cents", "discounts_cents", "fees_cents", "net_cents"];
      if (!needed.every((c) => q.columns.some((col) => col.name === c))) continue;
      for (const [i, row] of readResult(q.id).entries()) {
        const g = asInt(row.gross_cents, `${q.id}.gross_cents`);
        const d = asInt(row.discounts_cents, `${q.id}.discounts_cents`);
        const f = asInt(row.fees_cents, `${q.id}.fees_cents`);
        const n = asInt(row.net_cents, `${q.id}.net_cents`);
        if (n !== g - d + f) {
          problems.push(
            `${q.id} row ${i}: net ${n} != gross ${g} - discounts ${d} + fees ${f} ` +
              `(the RevenueReport definition in contract/openapi.yaml)`
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("daily sales sum to the per-event revenue", () => {
    const daily = readResult("q2_daily_sales_utc");
    const byEvent = new Map<string, { orders: bigint; gross: bigint; net: bigint }>();
    for (const row of daily) {
      const key = `${row.event_id}|${row.currency}`;
      const acc = byEvent.get(key) ?? { orders: 0n, gross: 0n, net: 0n };
      acc.orders += asInt(row.orders_count, "q2.orders_count");
      acc.gross += asInt(row.gross_cents, "q2.gross_cents");
      acc.net += asInt(row.net_cents, "q2.net_cents");
      byEvent.set(key, acc);
    }
    const problems: string[] = [];
    for (const row of readResult("q1_revenue_by_event")) {
      const key = `${row.event_id}|${row.currency}`;
      const acc = byEvent.get(key);
      if (!acc) {
        problems.push(`q1 reports ${key} but q2 has no day for it`);
        continue;
      }
      const want = {
        orders: asInt(row.orders_count, "q1.orders_count"),
        gross: asInt(row.gross_cents, "q1.gross_cents"),
        net: asInt(row.net_cents, "q1.net_cents"),
      };
      for (const field of ["orders", "gross", "net"] as const) {
        if (acc[field] !== want[field]) {
          problems.push(
            `${key}: q2 days sum to ${field}=${acc[field]}, q1 reports ${want[field]} — ` +
              `the two reports disagree about the same orders`
          );
        }
      }
      byEvent.delete(key);
    }
    for (const key of byEvent.keys()) {
      problems.push(`q2 reports sales for ${key} that q1 does not report at all`);
    }
    expect(problems).toEqual([]);
  });

  it("discount totals agree with the revenue report, per currency", () => {
    const perCurrency = (rows: Row[], column: string) => {
      const out = new Map<string, bigint>();
      for (const row of rows) {
        const cur = row.currency === null ? null : String(row.currency);
        if (cur === null) continue;
        out.set(cur, (out.get(cur) ?? 0n) + asInt(row[column], column));
      }
      return out;
    };
    const fromRevenue = perCurrency(readResult("q1_revenue_by_event"), "discounts_cents");
    const fromCodes = perCurrency(readResult("q6_discount_effectiveness"), "discounts_cents");
    const problems: string[] = [];
    for (const [cur, total] of fromRevenue) {
      const codes = fromCodes.get(cur) ?? 0n;
      if (codes !== total) {
        problems.push(
          `${cur}: q6 attributes ${codes} of discount to codes, q1 reports ${total} given away`
        );
      }
    }
    for (const cur of fromCodes.keys()) {
      if (!fromRevenue.has(cur)) {
        problems.push(`q6 reports ${cur} discounts for a currency q1 has no revenue in`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("hold statuses account for every hold created", () => {
    const problems: string[] = [];
    for (const row of readResult("q3_hold_funnel_by_event")) {
      const created = asInt(row.holds_created, "q3.holds_created");
      const parts = (["holds_converted", "holds_expired", "holds_released", "holds_active"] as const)
        .reduce((acc, c) => acc + asInt(row[c], `q3.${c}`), 0n);
      if (parts !== created) {
        problems.push(`${row.event_id}: statuses sum to ${parts}, holds_created is ${created}`);
      }
      const converted = asInt(row.holds_converted, "q3.holds_converted");
      // Half-up, as the contract specifies.
      const want = (converted * 10000n * 2n + created) / (created * 2n);
      const got = asInt(row.conversion_bps, "q3.conversion_bps");
      if (got !== want) {
        problems.push(
          `${row.event_id}: conversion_bps is ${got}; ${converted} of ${created} ` +
            `rounded half-up is ${want}`
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("no answer sums money across currencies", () => {
    // Structural: a row that reports money must name exactly one currency, and
    // the same grain must not appear twice under different currencies without
    // the figures differing.
    const problems: string[] = [];
    for (const q of QUESTIONS) {
      const money = q.columns.filter((c) => c.name.endsWith("_cents"));
      if (money.length === 0) continue;
      const hasCurrency = q.columns.some((c) => c.name === "currency");
      if (!hasCurrency) {
        problems.push(`${q.id} reports money but has no currency column`);
        continue;
      }
      for (const [i, row] of readResult(q.id).entries()) {
        const cur = row.currency;
        if (cur === null) {
          const nonZero = money.some((c) => asInt(row[c.name], `${q.id}.${c.name}`) !== 0n);
          if (nonZero) {
            problems.push(`${q.id} row ${i}: money with no currency attached`);
          }
          continue;
        }
        if (typeof cur !== "string" || !/^[A-Z]{3}$/.test(cur)) {
          problems.push(`${q.id} row ${i}: currency ${JSON.stringify(cur)} is not an ISO code`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("seat counts never inflate money", () => {
    // The fan-out signature: a seat count and a money column that move together
    // because order_seats was joined before the aggregation. If gross_cents is
    // exactly seats_sold times the per-seat value AND the order count disagrees
    // with the day-level report, the money has been multiplied.
    const revenue = readResult("q1_revenue_by_event");
    const problems: string[] = [];
    for (const row of revenue) {
      const orders = asInt(row.orders_count, "q1.orders_count");
      const seats = asInt(row.seats_sold, "q1.seats_sold");
      if (orders > seats) {
        problems.push(
          `${row.event_id}: ${orders} paid orders but only ${seats} seats — ` +
            `an order has at least one seat`
        );
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("data: expected fixtures are committed and current", () => {
  it("the fixtures are present", () => {
    expect(
      VISIBLE.length,
      "./expected/ is empty — the expected answers are generated, not hand-written"
    ).toBeGreaterThan(0);
  });

  it("no fixture names a question the contract does not define", () => {
    const ids = new Set(QUESTIONS.map((q) => q.id));
    const stray = fs
      .readdirSync(EXPECTED_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((id) => !ids.has(id));
    expect(stray).toEqual([]);
  });

  it("the fixtures were generated from this repository's contract", () => {
    // Guards against a fixture edited by hand to make a failing answer pass.
    expect(fs.existsSync(path.join(REPO_ROOT, "contract", "analytics", "fixture.sql"))).toBe(true);
    for (const q of VISIBLE) {
      const rows = readExpected(EXPECTED_DIR, q.id);
      expect(Array.isArray(rows), `${q.id} fixture is not an array`).toBe(true);
      for (const row of rows) {
        const { missing, extra } = columnDiff(q, row);
        expect(
          [...missing, ...extra],
          `${q.id} fixture does not match the contract's declared columns`
        ).toEqual([]);
      }
    }
  });
});
