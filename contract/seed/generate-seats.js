#!/usr/bin/env node
/**
 * Deterministic seat materializer for TicketForge seed.
 * Reads seed.json and writes seats.json — same output every run.
 * Seat ids: seat_{eventSuffix}_{section}{row}{nn} e.g. seat_arena_A01-01
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const seed = JSON.parse(fs.readFileSync(path.join(root, "seed.json"), "utf8"));

const EVENT_SUFFIX = {
  event_arena_2000: "arena",
  event_club_100: "club",
  event_jazz_eur: "jazz",
  event_draft: "draft",
  event_cancelled: "canc",
};

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

const seats = [];
for (const event of seed.events) {
  const layout = event.seat_layout;
  const suffix = EVENT_SUFFIX[event.id];
  let count = 0;
  for (const section of layout.sections) {
    const delta = layout.section_price_delta_cents[section] ?? 0;
    const price = event.base_price_cents + delta;
    for (let r = 1; r <= layout.rows_per_section; r++) {
      const row = pad(r);
      for (let n = 1; n <= layout.seats_per_row; n++) {
        count++;
        seats.push({
          id: `seat_${suffix}_${section}${row}-${pad(n)}`,
          event_id: event.id,
          section,
          row: row,
          number: n,
          status: "available",
          price_cents: price,
        });
      }
    }
  }
  if (count !== layout.total) {
    throw new Error(
      `${event.id}: expected ${layout.total} seats, got ${count}`
    );
  }
}

const out = {
  generated_by: "generate-seats.js",
  total: seats.length,
  seats,
};

fs.writeFileSync(path.join(root, "seats.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${seats.length} seats to seats.json`);

const arena = seats.filter((s) => s.event_id === "event_arena_2000");
console.log(`Arena seats: ${arena.length} (must be 2000)`);
