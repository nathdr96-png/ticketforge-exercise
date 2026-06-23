import { createHash, randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { computeDiscountCents, computeFeeCents, config } from "../config.js";
import { type Client, query, withTransaction } from "../db/pool.js";
import { AppError } from "../lib/errors.js";
import type { AuthUser } from "./auth.js";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redis.on("error", () => {
      /* non-fatal — Postgres row locks are authoritative */
    });
  }
  return redis;
}

async function redisSetNx(key: string, value: string, ttlSec: number): Promise<boolean> {
  try {
    const r = getRedis();
    if (r.status !== "ready") {
      await r.connect().catch(() => undefined);
    }
    if (r.status !== "ready") return true; // skip advisory lock if Redis down
    const ok = await r.set(key, value, "EX", ttlSec, "NX");
    return ok === "OK";
  } catch {
    return true; // degrade gracefully
  }
}

async function redisDel(key: string): Promise<void> {
  try {
    const r = getRedis();
    if (r.status === "ready") await r.del(key);
  } catch {
    /* ignore */
  }
}

function iso(d: Date): string {
  return d.toISOString();
}

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export async function listEvents(page: number, pageSize: number, status?: string) {
  const params: unknown[] = [];
  let where = "WHERE status = 'published'";
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  const countRes = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM events ${where}`, params);
  const total = Number(countRes.rows[0]?.count ?? 0);
  params.push(pageSize, page * pageSize);
  const { rows } = await query(
    `SELECT e.*,
            (SELECT COUNT(*)::int FROM seats s WHERE s.event_id = e.id) AS seat_count
     FROM events e
     ${where}
     ORDER BY e.starts_at ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    data: rows.map(mapEvent),
    page,
    page_size: pageSize,
    total,
  };
}

export async function getEvent(eventId: string) {
  const { rows } = await query(
    `SELECT e.*,
            (SELECT COUNT(*)::int FROM seats s WHERE s.event_id = e.id) AS seat_count
     FROM events e WHERE e.id = $1`,
    [eventId]
  );
  if (!rows[0]) throw new AppError("EVENT_NOT_FOUND", "Event not found");
  return mapEvent(rows[0]);
}

function mapEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizer_id: row.organizer_id,
    title: row.title,
    description: row.description,
    venue: row.venue,
    starts_at: iso(new Date(row.starts_at as string)),
    currency: row.currency,
    base_price_cents: Number(row.base_price_cents),
    status: row.status,
    seat_count: Number(row.seat_count),
  };
}

export async function listSeats(
  eventId: string,
  page: number,
  pageSize: number,
  section?: string,
  availability?: string
) {
  await getEvent(eventId);
  if (section && !["A", "B", "C", "D"].includes(section)) {
    throw new AppError("VALIDATION_ERROR", "Invalid section filter");
  }
  if (availability && !["available", "held", "sold"].includes(availability)) {
    throw new AppError("VALIDATION_ERROR", "Invalid availability filter");
  }
  const params: unknown[] = [eventId];
  const filters = ["event_id = $1"];
  if (section) {
    params.push(section);
    filters.push(`section = $${params.length}`);
  }
  if (availability) {
    params.push(availability);
    filters.push(`status = $${params.length}`);
  }
  const where = filters.join(" AND ");
  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM seats WHERE ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.count ?? 0);
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT id, event_id, section, row_label AS row, number, status, price_cents
     FROM seats
     WHERE ${where}
     ORDER BY section, row_label, number
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    data: rows.map((r) => ({
      id: r.id,
      event_id: r.event_id,
      section: r.section,
      row: r.row,
      number: Number(r.number),
      status: r.status,
      price_cents: Number(r.price_cents),
    })),
    page,
    page_size: pageSize,
    total,
  };
}

/**
 * Concurrency strategy:
 * 1. Redis SET NX lock per seat (fast fail under load)
 * 2. Inside a Postgres transaction, SELECT ... FOR UPDATE on seats ordered by id
 * 3. Re-check status === available, then mark held
 */
export async function createHold(user: AuthUser, eventId: string, seatIds: string[]) {
  if (seatIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "seat_ids required");
  }

  const unique = [...new Set(seatIds)].sort();
  const lockKeys: string[] = [];
  try {
    for (const seatId of unique) {
      const key = `holdlock:${seatId}`;
      const ok = await redisSetNx(key, user.id, config.holdTtlSeconds);
      if (!ok) {
        throw new AppError("SEAT_ALREADY_HELD", "Seat is currently held", { seat_id: seatId });
      }
      lockKeys.push(key);
    }

    return await withTransaction(async (client) => {
      await getEvent(eventId);

      const { rows: seats } = await client.query<{
        id: string;
        event_id: string;
        status: string;
        price_cents: number;
      }>(
        `SELECT id, event_id, status, price_cents
         FROM seats
         WHERE id = ANY($1::text[])
         ORDER BY id
         FOR UPDATE`,
        [unique]
      );

      if (seats.length !== unique.length) {
        throw new AppError("SEAT_NOT_FOUND", "One or more seats not found");
      }

      for (const seat of seats) {
        if (seat.event_id !== eventId) {
          throw new AppError("VALIDATION_ERROR", "Seat does not belong to event", {
            seat_id: seat.id,
          });
        }
        if (seat.status === "held") {
          throw new AppError("SEAT_ALREADY_HELD", "Seat is currently held", { seat_id: seat.id });
        }
        if (seat.status === "sold") {
          throw new AppError("SEAT_NOT_AVAILABLE", "Seat is sold", { seat_id: seat.id });
        }
      }

      const holdId = `hold_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const now = new Date();
      const expires = new Date(now.getTime() + config.holdTtlSeconds * 1000);

      await client.query(
        `INSERT INTO holds (id, event_id, buyer_id, status, expires_at, created_at)
         VALUES ($1,$2,$3,'active',$4,$5)`,
        [holdId, eventId, user.id, expires.toISOString(), now.toISOString()]
      );

      for (const seatId of unique) {
        await client.query(`INSERT INTO hold_seats (hold_id, seat_id) VALUES ($1,$2)`, [
          holdId,
          seatId,
        ]);
        await client.query(
          `UPDATE seats SET status = 'held', hold_id = $1, version = version + 1 WHERE id = $2`,
          [holdId, seatId]
        );
      }

      await client.query(
        `INSERT INTO outbox_events (event_type, payload)
         VALUES ('hold.created', $1::jsonb)`,
        [
          JSON.stringify({
            event_type: "hold.created",
            hold_id: holdId,
            event_id: eventId,
            buyer_id: user.id,
            seat_ids: unique,
            expires_at: iso(expires),
            occurred_at: iso(now),
          }),
        ]
      );

      return {
        id: holdId,
        event_id: eventId,
        buyer_id: user.id,
        seat_ids: unique,
        status: "active" as const,
        expires_at: iso(expires),
        created_at: iso(now),
      };
    });
  } catch (err) {
    for (const key of lockKeys) {
      await redisDel(key);
    }
    throw err;
  }
}

export async function getHold(user: AuthUser, holdId: string) {
  const hold = await fetchHold(holdId);
  if (user.role !== "admin" && hold.buyer_id !== user.id) {
    throw new AppError("INSUFFICIENT_PERMISSION", "Not your hold");
  }
  if (hold.status === "active" && new Date(hold.expires_at) <= new Date()) {
    await expireHold(holdId);
    throw new AppError("HOLD_EXPIRED", "Hold has expired");
  }
  return hold;
}

async function fetchHold(holdId: string, client?: Client) {
  const { rows } = await query(
    `SELECT h.*, COALESCE(array_agg(hs.seat_id ORDER BY hs.seat_id) FILTER (WHERE hs.seat_id IS NOT NULL), '{}') AS seat_ids
     FROM holds h
     LEFT JOIN hold_seats hs ON hs.hold_id = h.id
     WHERE h.id = $1
     GROUP BY h.id`,
    [holdId],
    client
  );
  if (!rows[0]) throw new AppError("HOLD_NOT_FOUND", "Hold not found");
  const row = rows[0];
  return {
    id: row.id as string,
    event_id: row.event_id as string,
    buyer_id: row.buyer_id as string,
    seat_ids: row.seat_ids as string[],
    status: row.status as string,
    expires_at: iso(new Date(row.expires_at as string)),
    created_at: iso(new Date(row.created_at as string)),
  };
}

export async function releaseHold(user: AuthUser, holdId: string) {
  await withTransaction(async (client) => {
    const hold = await fetchHold(holdId, client);
    if (user.role !== "admin" && hold.buyer_id !== user.id) {
      throw new AppError("INSUFFICIENT_PERMISSION", "Not your hold");
    }
    if (hold.status === "expired" || hold.status === "released") {
      throw new AppError("HOLD_EXPIRED", "Hold has expired");
    }
    if (hold.status === "converted") {
      throw new AppError("HOLD_ALREADY_CONVERTED", "Hold already converted");
    }
    const seatIds = hold.seat_ids;
    await client.query(`UPDATE holds SET status = 'released' WHERE id = $1`, [holdId]);
    await client.query(
      `UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
       WHERE hold_id = $1`,
      [holdId]
    );
    await client.query(`DELETE FROM hold_seats WHERE hold_id = $1`, [holdId]);
    for (const seatId of seatIds) {
      await redisDel(`holdlock:${seatId}`);
    }
  });
}

export async function expireHold(holdId: string) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM holds WHERE id = $1 FOR UPDATE`, [holdId]);
    const hold = rows[0];
    if (!hold || hold.status !== "active") return;

    const { rows: seatRows } = await client.query<{ seat_id: string }>(
      `SELECT seat_id FROM hold_seats WHERE hold_id = $1`,
      [holdId]
    );
    const seatIds = seatRows.map((s) => s.seat_id);

    await client.query(`UPDATE holds SET status = 'expired' WHERE id = $1`, [holdId]);
    await client.query(
      `UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
       WHERE hold_id = $1 AND status = 'held'`,
      [holdId]
    );
    await client.query(`DELETE FROM hold_seats WHERE hold_id = $1`, [holdId]);
    await client.query(
      `INSERT INTO outbox_events (event_type, payload) VALUES ('hold.expired', $1::jsonb)`,
      [
        JSON.stringify({
          event_type: "hold.expired",
          hold_id: holdId,
          event_id: hold.event_id,
          buyer_id: hold.buyer_id,
          seat_ids: seatIds,
          occurred_at: iso(new Date()),
        }),
      ]
    );

    for (const seatId of seatIds) {
      await redisDel(`holdlock:${seatId}`);
    }
  });
}

export async function createOrder(
  user: AuthUser,
  idempotencyKey: string | undefined,
  body: { hold_id: string; discount_code?: string | null }
) {
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required");
  }

  const requestHash = hashBody(body);

  return withTransaction(async (client) => {
    const existing = await client.query<{
      request_hash: string;
      order_id: string;
    }>(
      `SELECT request_hash, order_id FROM idempotency_records
       WHERE buyer_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [user.id, idempotencyKey]
    );

    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) {
        throw new AppError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Idempotency key reused with a different body"
        );
      }
      return { order: await fetchOrder(existing.rows[0].order_id, client), replay: true };
    }

    const hold = await fetchHold(body.hold_id, client);
    if (hold.buyer_id !== user.id && user.role !== "admin") {
      throw new AppError("INSUFFICIENT_PERMISSION", "Not your hold");
    }
    // TODO(FEAT-33): checkout does not yet refuse a hold that is no longer live.

    await client.query(`SELECT id FROM holds WHERE id = $1 FOR UPDATE`, [body.hold_id]);

    const { rows: seatRows } = await client.query<{
      id: string;
      price_cents: number;
      status: string;
    }>(
      `SELECT id, price_cents, status FROM seats WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [hold.seat_ids]
    );

    const subtotal = seatRows.reduce((sum, s) => sum + Number(s.price_cents), 0);

    // TODO(FEAT-18): discount codes are not implemented yet.
    const discountCents = 0;
    const discountCode: string | null = null;

    const afterDiscount = subtotal - discountCents;
    const feeCents = computeFeeCents(afterDiscount);
    const totalCents = afterDiscount + feeCents;

    const { rows: eventRows } = await client.query<{ currency: string }>(
      `SELECT currency FROM events WHERE id = $1`,
      [hold.event_id]
    );

    const orderId = `ord_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date();

    await client.query(
      `INSERT INTO orders
         (id, hold_id, buyer_id, event_id, subtotal_cents, fee_cents, discount_cents,
          total_cents, currency, discount_code, status, idempotency_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paid',$11,$12)`,
      [
        orderId,
        body.hold_id,
        user.id,
        hold.event_id,
        subtotal,
        feeCents,
        discountCents,
        totalCents,
        eventRows[0].currency,
        discountCode,
        idempotencyKey,
        now.toISOString(),
      ]
    );

    for (const seat of seatRows) {
      await client.query(`INSERT INTO order_seats (order_id, seat_id) VALUES ($1,$2)`, [
        orderId,
        seat.id,
      ]);
      await client.query(
        `UPDATE seats SET status = 'sold', hold_id = NULL, version = version + 1 WHERE id = $1`,
        [seat.id]
      );
    }

    await client.query(`UPDATE holds SET status = 'converted' WHERE id = $1`, [body.hold_id]);

    await client.query(
      `INSERT INTO idempotency_records (buyer_id, idempotency_key, request_hash, order_id)
       VALUES ($1,$2,$3,$4)`,
      [user.id, idempotencyKey, requestHash, orderId]
    );

    await client.query(
      `INSERT INTO outbox_events (event_type, payload) VALUES ('order.paid', $1::jsonb)`,
      [
        JSON.stringify({
          event_type: "order.paid",
          order_id: orderId,
          hold_id: body.hold_id,
          event_id: hold.event_id,
          buyer_id: user.id,
          total_cents: totalCents,
          currency: eventRows[0].currency,
          occurred_at: iso(now),
        }),
      ]
    );

    for (const seatId of hold.seat_ids) {
      await redisDel(`holdlock:${seatId}`);
    }

    return { order: await fetchOrder(orderId, client), replay: false };
  });
}

async function fetchOrder(orderId: string, client?: Client) {
  const { rows } = await query(
    `SELECT o.*,
            COALESCE(array_agg(os.seat_id ORDER BY os.seat_id) FILTER (WHERE os.seat_id IS NOT NULL), '{}') AS seat_ids
     FROM orders o
     LEFT JOIN order_seats os ON os.order_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [orderId],
    client
  );
  if (!rows[0]) throw new AppError("ORDER_NOT_FOUND", "Order not found");
  const row = rows[0];
  return {
    id: row.id,
    hold_id: row.hold_id,
    buyer_id: row.buyer_id,
    event_id: row.event_id,
    seat_ids: row.seat_ids,
    subtotal_cents: Number(row.subtotal_cents),
    fee_cents: Number(row.fee_cents),
    discount_cents: Number(row.discount_cents),
    total_cents: Number(row.total_cents),
    currency: row.currency,
    discount_code: row.discount_code,
    status: row.status,
    created_at: iso(new Date(row.created_at as string)),
  };
}

export async function getOrder(user: AuthUser, orderId: string) {
  const order = await fetchOrder(orderId);
  if (user.role === "admin" || order.buyer_id === user.id) return order;

  if (user.role === "organizer") {
    const { rows } = await query(`SELECT organizer_id FROM events WHERE id = $1`, [order.event_id]);
    if (rows[0]?.organizer_id === user.id) return order;
  }

  throw new AppError("INSUFFICIENT_PERMISSION", "Not allowed to view this order");
}

export async function revenueReport(
  user: AuthUser,
  filters: { event_id?: string; from?: string; to?: string }
) {
  if (user.role !== "organizer" && user.role !== "admin") {
    throw new AppError("INSUFFICIENT_PERMISSION", "Organizer role required");
  }

  const params: unknown[] = [];
  const clauses: string[] = ["o.status = 'paid'"];

  if (user.role === "organizer") {
    params.push(user.id);
    clauses.push(`e.organizer_id = $${params.length}`);
  }
  if (filters.event_id) {
    params.push(filters.event_id);
    clauses.push(`o.event_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`o.created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`o.created_at <= $${params.length}`);
  }

  const where = clauses.join(" AND ");
  const { rows } = await query(
    `SELECT o.event_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(o.subtotal_cents),0)::int AS gross_cents,
            COALESCE(SUM(o.fee_cents),0)::int AS fees_cents,
            COALESCE(SUM(o.discount_cents),0)::int AS discounts_cents,
            COALESCE(SUM(o.total_cents),0)::int AS net_cents,
            MIN(e.currency) AS currency
     FROM orders o
     JOIN events e ON e.id = o.event_id
     WHERE ${where}
     GROUP BY o.event_id
     ORDER BY o.event_id`,
    params
  );

  const byEvent = rows.map((r) => ({
    event_id: r.event_id as string,
    order_count: Number(r.order_count),
    gross_cents: Number(r.gross_cents),
    net_cents: Number(r.net_cents),
  }));

  const gross = byEvent.reduce((s, r) => s + r.gross_cents, 0);
  const fees = rows.reduce((s, r) => s + Number(r.fees_cents), 0);
  const discounts = rows.reduce((s, r) => s + Number(r.discounts_cents), 0);
  const net = byEvent.reduce((s, r) => s + r.net_cents, 0);

  return {
    currency: (rows[0]?.currency as string) ?? "USD",
    gross_cents: gross,
    fees_cents: fees,
    discounts_cents: discounts,
    net_cents: net,
    by_event: byEvent,
  };
}
