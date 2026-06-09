import { describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://ticketforge:ticketforge@localhost:5432/ticketforge";

describe("db schema + indexes", () => {
  it("required tables exist", async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      const names = rows.map((r) => r.table_name);
      for (const t of [
        "users",
        "events",
        "seats",
        "holds",
        "hold_seats",
        "orders",
        "order_seats",
        "discounts",
        "idempotency_records",
        "outbox_events",
      ]) {
        expect(names).toContain(t);
      }
    } finally {
      await client.end();
    }
  });

  it("seat-map query uses an index", async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(`
        EXPLAIN (FORMAT JSON)
        SELECT id, event_id, section, row_label, number, status, price_cents
        FROM seats
        WHERE event_id = 'event_arena_2000' AND status = 'available'
        ORDER BY section, row_label, number
        LIMIT 100
      `);
      const planText = JSON.stringify(rows[0]["QUERY PLAN"]);
      const usesIndex =
        /Index Scan|Bitmap Index Scan|Index Only Scan/i.test(planText) &&
        !/"Node Type":"Seq Scan".*"Relation Name":"seats"/i.test(planText.replace(/\s/g, ""));
      // Prefer index; allow bitmap heap as long as index is involved
      expect(planText).toMatch(/Index/i);
      expect(usesIndex || /Bitmap/i.test(planText)).toBe(true);
    } finally {
      await client.end();
    }
  });
});
