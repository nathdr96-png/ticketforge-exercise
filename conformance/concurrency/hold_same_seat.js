import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter } from "k6/metrics";

/**
 * 200 VUs attempt to hold the SAME seat simultaneously.
 * Exactly one must win (201); the rest must get 409 SEAT_ALREADY_HELD / SEAT_NOT_AVAILABLE.
 *
 * Env:
 *   BASE_URL   default http://127.0.0.1:3000
 *   SEAT_ID    required — pre-picked available seat
 *   EVENT_ID   default event_arena_2000
 *   PASSWORD   default password123
 */

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3000";
const EVENT_ID = __ENV.EVENT_ID || "event_arena_2000";
const SEAT_ID = __ENV.SEAT_ID;
const PASSWORD = __ENV.PASSWORD || "password123";

const wins = new Counter("hold_wins");
const losses = new Counter("hold_losses");

const buyers = new SharedArray("buyers", () => {
  const list = [];
  for (let i = 1; i <= 50; i++) {
    const n = String(i).padStart(2, "0");
    list.push(`buyer${n}@ticketforge.test`);
  }
  return list;
});

export const options = {
  scenarios: {
    same_seat: {
      executor: "per-vu-iterations",
      vus: 200,
      iterations: 1,
      maxDuration: "60s",
    },
  },
  thresholds: {
    hold_wins: ["count==1"],
    http_req_failed: ["rate<0.95"],
  },
};

export function setup() {
  if (!SEAT_ID) {
    throw new Error("SEAT_ID env var required");
  }
  return { seatId: SEAT_ID };
}

export default function (data) {
  const email = buyers[(__VU - 1) % buyers.length];
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  const token = loginRes.json("token");
  const res = http.post(
    `${BASE_URL}/holds`,
    JSON.stringify({ event_id: EVENT_ID, seat_ids: [data.seatId] }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (res.status === 201) {
    wins.add(1);
  } else {
    losses.add(1);
    check(res, {
      "conflict error": (r) => {
        try {
          const code = r.json("error.code");
          return r.status === 409 && (code === "SEAT_ALREADY_HELD" || code === "SEAT_NOT_AVAILABLE");
        } catch {
          return false;
        }
      },
    });
  }
  sleep(0.01);
}
