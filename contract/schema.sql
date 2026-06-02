-- TicketForge canonical Postgres schema
-- Money: integer cents. Timestamps: timestamptz (UTC).
-- Implementations MAY add columns but MUST preserve these tables/columns/indexes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('admin', 'organizer', 'buyer');
CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled');
CREATE TYPE seat_status AS ENUM ('available', 'held', 'sold');
CREATE TYPE hold_status AS ENUM ('active', 'expired', 'released', 'converted');
CREATE TYPE order_status AS ENUM ('paid', 'refunded');
CREATE TYPE seat_section AS ENUM ('A', 'B', 'C', 'D');

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  organizer_id     TEXT NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  venue            TEXT NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  currency         CHAR(3) NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 0),
  status           event_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX events_organizer_id_idx ON events (organizer_id);
CREATE INDEX events_status_starts_at_idx ON events (status, starts_at);

CREATE TABLE seats (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section     seat_section NOT NULL,
  row_label   TEXT NOT NULL,
  number      INTEGER NOT NULL CHECK (number > 0),
  status      seat_status NOT NULL DEFAULT 'available',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  hold_id     TEXT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, section, row_label, number)
);

-- Critical for seat-map endpoint (T4): filter by event + optional section/status
CREATE INDEX seats_event_id_status_idx ON seats (event_id, status);
CREATE INDEX seats_event_id_section_idx ON seats (event_id, section);
CREATE INDEX seats_hold_id_idx ON seats (hold_id) WHERE hold_id IS NOT NULL;

CREATE TABLE holds (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id),
  buyer_id   TEXT NOT NULL REFERENCES users(id),
  status     hold_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX holds_buyer_id_idx ON holds (buyer_id);
CREATE INDEX holds_expires_at_active_idx ON holds (expires_at) WHERE status = 'active';

CREATE TABLE hold_seats (
  hold_id TEXT NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL REFERENCES seats(id),
  PRIMARY KEY (hold_id, seat_id)
  -- Exclusivity of *active* holds is enforced via seats.status / seats.hold_id,
  -- not a unique seat_id here (history may reuse a seat across released holds).
);

CREATE TABLE discounts (
  code            TEXT PRIMARY KEY,
  percent_off     INTEGER NOT NULL CHECK (percent_off >= 0 AND percent_off <= 100),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  stackable       BOOLEAN NOT NULL DEFAULT FALSE,
  event_id        TEXT NULL REFERENCES events(id)
);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  hold_id          TEXT NOT NULL UNIQUE REFERENCES holds(id),
  buyer_id         TEXT NOT NULL REFERENCES users(id),
  event_id         TEXT NOT NULL REFERENCES events(id),
  subtotal_cents   INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  fee_cents        INTEGER NOT NULL CHECK (fee_cents >= 0),
  discount_cents   INTEGER NOT NULL CHECK (discount_cents >= 0),
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  currency         CHAR(3) NOT NULL,
  discount_code    TEXT NULL REFERENCES discounts(code),
  status           order_status NOT NULL DEFAULT 'paid',
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (buyer_id, idempotency_key)
);

CREATE INDEX orders_event_id_idx ON orders (event_id);
CREATE INDEX orders_buyer_id_idx ON orders (buyer_id);
CREATE INDEX orders_created_at_idx ON orders (created_at);

CREATE TABLE order_seats (
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seat_id  TEXT NOT NULL REFERENCES seats(id),
  PRIMARY KEY (order_id, seat_id)
);

CREATE TABLE idempotency_records (
  buyer_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (buyer_id, idempotency_key)
);

CREATE TABLE outbox_events (
  id           BIGSERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL
);

CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;

COMMIT;

-- Fee formula (canonical, unless harness variant overrides):
--   fee_cents = floor(subtotal_cents * 5 / 100) + 30
-- Hold TTL default: 600 seconds
-- Discount: percent_off applied to subtotal before fee; fee computed on post-discount subtotal.
-- total_cents = (subtotal_cents - discount_cents) + fee_cents
