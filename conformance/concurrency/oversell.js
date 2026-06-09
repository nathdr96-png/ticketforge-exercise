import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

/**
 * 500 concurrent purchase attempts against event_club_100 (100 seats).
 * Assert final sold count ≤ 100 (no oversell).
 *
 * Env: BASE_URL, PASSWORD
 * Prefetch: each VU picks seat by index (VU % 100) — many VUs collide per seat.
 */

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3000";
const PASSWORD = __ENV.PASSWORD || "password123";
const EVENT_ID = "event_club_100";

const ordersCreated = new Counter("orders_created");

export const options = {
  scenarios: {
    oversell: {
      executor: "per-vu-iterations",
      vus: 500,
      iterations: 1,
      maxDuration: "120s",
    },
  },
  thresholds: {
    orders_created: ["count<=100"],
  },
};

export function setup() {
  const login = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: "buyer01@ticketforge.test", password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  const token = login.json("token");
  const seats = [];
  let page = 1;
  while (seats.length < 100) {
    const res = http.get(
      `${BASE_URL}/events/${EVENT_ID}/seats?availability=available&page=${page}&page_size=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = res.json("data") || [];
    if (!data.length) break;
    for (const s of data) seats.push(s.id);
    page += 1;
  }
  if (seats.length < 100) {
    throw new Error(`expected 100 club seats, got ${seats.length}`);
  }
  return { seats: seats.slice(0, 100) };
}

export default function (data) {
  const n = String(((__VU - 1) % 50) + 1).padStart(2, "0");
  const email = `buyer${n}@ticketforge.test`;
  const seatId = data.seats[(__VU - 1) % data.seats.length];

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  const token = loginRes.json("token");

  const holdRes = http.post(
    `${BASE_URL}/holds`,
    JSON.stringify({ event_id: EVENT_ID, seat_ids: [seatId] }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (holdRes.status !== 201) return;

  const holdId = holdRes.json("id");
  const orderRes = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ hold_id: holdId }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": `k6-oversell-${__VU}-${Date.now()}`,
      },
    }
  );

  if (orderRes.status === 201 || orderRes.status === 200) {
    orders_created.add(1);
    check(orderRes, { paid: (r) => r.json("status") === "paid" });
  }
}
