import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";
import { migrate } from "./migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, "../../../../../contract/seed");

interface SeedUser {
  id: string;
  email: string;
  role: string;
  name: string;
}

interface SeedEvent {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  venue: string;
  starts_at: string;
  currency: string;
  base_price_cents: number;
  status: string;
}

interface SeedSeat {
  id: string;
  event_id: string;
  section: string;
  row: string;
  number: number;
  status: string;
  price_cents: number;
}

interface SeedDiscount {
  code: string;
  percent_off: number;
  active: boolean;
  stackable: boolean;
  event_id: string | null;
}

export async function seed(): Promise<void> {
  await migrate();

  const seedJson = JSON.parse(fs.readFileSync(path.join(SEED_DIR, "seed.json"), "utf8"));
  const seatsJson = JSON.parse(fs.readFileSync(path.join(SEED_DIR, "seats.json"), "utf8"));
  const password = seedJson.meta.password_for_all_users as string;
  const hash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const u of seedJson.users as SeedUser[]) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, role, name)
         VALUES ($1, $2, $3, $4, $5)`,
        [u.id, u.email, hash, u.role, u.name]
      );
    }

    for (const e of seedJson.events as SeedEvent[]) {
      await client.query(
        `INSERT INTO events
           (id, organizer_id, title, description, venue, starts_at, currency, base_price_cents, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          e.id,
          e.organizer_id,
          e.title,
          e.description,
          e.venue,
          e.starts_at,
          e.currency,
          e.base_price_cents,
          e.status,
        ]
      );
    }

    const seats = seatsJson.seats as SeedSeat[];
    const batchSize = 200;
    for (let i = 0; i < seats.length; i += batchSize) {
      const chunk = seats.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      chunk.forEach((s, idx) => {
        const o = idx * 7;
        placeholders.push(
          `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7})`
        );
        values.push(s.id, s.event_id, s.section, s.row, s.number, s.status, s.price_cents);
      });
      await client.query(
        `INSERT INTO seats (id, event_id, section, row_label, number, status, price_cents)
         VALUES ${placeholders.join(",")}`,
        values
      );
    }

    for (const d of seedJson.discounts as SeedDiscount[]) {
      await client.query(
        `INSERT INTO discounts (code, percent_off, active, stackable, event_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [d.code, d.percent_off, d.active, d.stackable, d.event_id]
      );
    }

    await client.query("COMMIT");
    console.log(
      `Seeded ${seedJson.users.length} users, ${seedJson.events.length} events, ${seats.length} seats`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
