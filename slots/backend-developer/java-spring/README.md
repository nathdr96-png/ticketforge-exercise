# backend/java-spring

TicketForge backend — **Java 21 + Spring Boot 3 + JdbcTemplate + Postgres**.

A complete implementation of the TicketForge contract in Java: the status codes, error codes,
JSON field names, money math and locking behaviour the contract specifies. The contract
(`contract/openapi.yaml`, `contract/schema.sql`, `contract/errors.md`, `contract/seed/`) is
the single source of truth and is never modified.

## Quick start

```bash
# Always set DATABASE_URL explicitly: any Postgres database you can create tables in.
# `docker compose up -d postgres` from the repo root gives you this one.
export DATABASE_URL="postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge"
make build          # package the fat jar
make seed           # apply contract/schema.sql, then load contract/seed/*.json
PORT=8080 make run  # serve the API
curl localhost:8080/health      # -> {"status":"ok"}
```

The `Makefile` sets `JAVA_HOME` itself, so the targets work without any shell setup.

| target    | does                                                                |
| --------- | ------------------------------------------------------------------- |
| `install` | resolve all Maven dependencies (`dependency:go-offline`)             |
| `migrate` | drop + recreate `public`, then apply `contract/schema.sql` verbatim  |
| `seed`    | `migrate`, then load `contract/seed/{seed,seats}.json`               |
| `run`     | start the HTTP API on `$PORT` (default 3000)                        |
| `build`   | `mvn package` → `target/ticketforge-java-spring.jar`                 |
| `test`    | JUnit 5 unit tests (money math, URL parsing)                        |
| `lint`    | full `javac` compile of main + test sources — the analogue of `tsc --noEmit` |

`migrate` and `seed` are the same Spring context as the server, run as one-shot CLI tasks:

```bash
java -jar target/ticketforge-java-spring.jar --app.task=migrate
java -jar target/ticketforge-java-spring.jar --app.task=seed       # migrate + fixtures
java -jar target/ticketforge-java-spring.jar --app.task=seed-only  # fixtures only
```

## Configuration

Read from the environment (`.env.example` lists the variables). Set `DATABASE_URL` explicitly
before running any `make` target rather than relying on a default. It accepts **either** the
libpq form used across this monorepo (`postgres://user[:pass]@host:port/db`) **or** a plain
JDBC URL; `DatabaseUrl` normalises it.

| var | default | notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DATABASE_URL` | `jdbc:postgresql://127.0.0.1:5432/ticketforge` (app fallback) | libpq or JDBC; export it explicitly |
| `JWT_SECRET` | `ticketforge-dev-secret-change-me` | HS256, stretched to 256 bits with SHA-256 |
| `HOLD_TTL_SECONDS` | `600` | contract default |
| `FEE_PERCENT` / `FEE_FIXED_CENTS` | `5` / `30` | contract default |
| `HOLD_EXPIRY_INTERVAL_MS` | `1000` | expiry worker poll interval |
| `CONTRACT_DIR` | auto-discovered | only needed if `contract/` is not an ancestor of the cwd |

**Redis is not a dependency.** A Redis `SET NX` advisory lock would only ever be an optional
fast-fail; correctness here rests on Postgres row locks alone.

## Design notes

### No ORM on the schema path

`spring-boot-starter-jdbc` only — JPA/Hibernate is not on the classpath, and
`spring.jpa.hibernate.ddl-auto=none` / `spring.sql.init.mode=never` are set as belt-and-braces.
`MigrationRunner` reads `contract/schema.sql` and hands it to the server verbatim, so the
canonical DDL (enums, partial indexes, check constraints) is exactly what exists in the
database. Every query is hand-written SQL, which keeps the locking reviewable.

### Concurrency: ordered `SELECT … FOR UPDATE`

`TicketForgeService.createHold` runs in one transaction:

1. `SELECT id, event_id, status, price_cents FROM seats WHERE id IN (…) ORDER BY id FOR UPDATE`
   — the deterministic `ORDER BY id` (seat ids are de-duplicated into a `TreeSet` first) is
   what stops two buyers requesting overlapping seat sets in opposite orders from deadlocking.
2. Re-check each locked row's status; `held` → `409 SEAT_ALREADY_HELD`, `sold` →
   `409 SEAT_NOT_AVAILABLE`.
3. Insert the hold, `hold_seats` rows, flip seats to `held` and bump `version`.

A concurrent loser blocks on the row lock, then observes `held` and gets a 409 — it can never
observe the pre-commit state. Hold→order conversion repeats the same ordered `FOR UPDATE`
over the hold's seats plus `SELECT id FROM holds WHERE id = ? FOR UPDATE`, so a hold cannot be
converted twice and seats cannot be oversold. `POST /orders` also takes
`SELECT … FROM idempotency_records … FOR UPDATE` before doing anything else, so two
simultaneous replays of one key cannot both create an order.

### Hold expiry

`HoldExpiryWorker` polls once a second (`@Scheduled`) for `status = 'active' AND expires_at <= NOW()`
and expires each hold: status → `expired`, seats back to `available`, `hold_seats` cleared, a
`hold.expired` row appended to `outbox_events`. `GET /holds/{id}` and `POST /orders` also expire
a hold lazily on touch and answer `410 HOLD_EXPIRED`.

`HoldExpiryService` is a separate bean using `Propagation.REQUIRES_NEW`, precisely so that when
`POST /orders` finds an elapsed hold the release **commits** even though the request's own
transaction then rolls back with `HOLD_EXPIRED`.

### Money

Integer minor units in `long` throughout — request, response, storage and every intermediate.
No `double`, `float` or `BigDecimal` anywhere on the money path. `Money` uses
`Math.floorDiv`, so the fee is floored and never rounded:

```
discount_cents = floor(subtotal * percent_off / 100)
fee_cents      = floor((subtotal - discount) * FEE_PERCENT / 100) + FEE_FIXED_CENTS
total_cents    = (subtotal - discount) + fee_cents
```

A 4500c seat with `SAVE10`: subtotal 4500, discount 450, `floor(4050 * 5 / 100) = 202`,
fee 232, total 4282 — rounding would give 233. Covered by `MoneyTest`.

### Forcing Spring's errors into the contract envelope

Spring has three independent ways to emit an error, and all of them are intercepted so that
**every** response body is `{"error":{"code","message","details?"}}` from `contract/errors.md`:

| escape hatch | default output | replacement |
| --- | --- | --- |
| exception from a controller | `DefaultErrorAttributes` JSON (`timestamp/status/error/path`) | `GlobalExceptionHandler` (`@RestControllerAdvice`) |
| Spring Security 401 | empty body + `WWW-Authenticate` challenge | `ContractAuthenticationEntryPoint` |
| Spring Security 403 | Whitelabel / access-denied page | `ContractAccessDeniedHandler` |
| container forward to `/error` | Whitelabel HTML page | `ContractErrorController implements ErrorController` |

Supporting settings: `server.error.whitelabel.enabled=false`,
`spring.mvc.throw-exception-if-no-handler-found=true` and `spring.web.resources.add-mappings=false`
so an unknown path raises `NoHandlerFoundException` and becomes `404 NOT_FOUND` in the envelope
instead of a static-resource 404.

`ErrorCode` owns the code → HTTP status mapping, so a status can never drift from its code.

### Auth

`POST /auth/login` verifies bcrypt against `users.password_hash` and returns an HS256 JWT
(`sub`, `role`, 12h). Seeded hashes are bcrypt **cost 10** as `seed.json#meta` requires;
Spring's `BCryptPasswordEncoder(10)` emits and verifies the standard `$2a$10$…` format, so
hashes produced by any other standard bcrypt implementation (e.g. `bcryptjs`) verify here too.

`JwtAuthFilter` resolves the bearer token to an `AuthUser` by re-reading the users table on
every request (so a role change takes effect immediately). It deliberately never writes a
response: a missing or bad token just leaves the `SecurityContext` empty and the authorization
step produces the 401, keeping envelope generation in one place.

Role and ownership checks live in the service layer so the thrown `AppException` carries the
contract's own code and message:

- `GET /reports/revenue` — organizer or admin; an organizer sees only their own events.
- `GET /orders/{id}` — buyer who owns it, the event's organizer, or an admin; else 403.
- `GET`/`DELETE /holds/{id}` — owner or admin; else 403.

### Timestamps

All timestamps are UTC ISO-8601 with millisecond precision and a `Z` suffix, rendered by
`Iso` into `String` fields — byte-identical to JavaScript's `toISOString()`. Because the DTOs
carry strings, no Jackson date policy can turn them into epoch millis;
`write-dates-as-timestamps: false` and `time-zone: UTC` are set anyway.

### Enum filters and injection

`section` and `availability` are validated against allowlists and bound as parameters with an
explicit `?::seat_section` / `?::seat_status` cast. `?section=A' OR '1'='1` is a clean
`400 VALIDATION_ERROR`. No SQL string ever interpolates user input.

## Layout

```
pom.xml                       Spring Boot 3.3.5, Java 21, jjwt 0.12.6
src/main/java/com/ticketforge/
  TicketForgeApplication.java core app; --app.task runs headless
  api/ApiController.java      every route in contract/openapi.yaml
  api/Dtos.java               wire shapes (snake_case, long cents, String timestamps)
  config/AppProperties.java   typed environment configuration
  config/Money.java           integer-cents fee/discount/total
  config/Iso.java             UTC ISO-8601 with millis
  config/SecurityConfig.java  filter chain, bcrypt(10), CORS
  db/DatabaseUrl.java         libpq ⇄ JDBC URL
  db/DataSourceConfig.java    Hikari, max 20 connections
  db/ContractLocator.java     finds contract/ by walking up
  db/MigrationRunner.java     applies contract/schema.sql verbatim
  db/SeedLoader.java          deterministic contract/seed/*.json load
  db/CliTaskRunner.java       --app.task=migrate|seed|seed-only
  error/                      ErrorCode, AppException, ErrorBody + the 4 interceptors
  security/                   JwtService, JwtAuthFilter, AuthUser
  service/AuthService.java    bcrypt login, JWT issue
  service/TicketForgeService.java  events, seats, holds, orders, revenue
  service/HoldExpiryService.java   REQUIRES_NEW hold expiry
  worker/HoldExpiryWorker.java     @Scheduled poller
src/test/java/com/ticketforge/     MoneyTest, DatabaseUrlTest
```

## Conformance

From the repo root, with the app running:

```bash
export BASE_URL="http://127.0.0.1:<port>"
export DATABASE_URL="postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge"   # same DB the app uses
(cd conformance/api      && npm install --silent && npx vitest run)   # 15 passed
(cd conformance/security && npm install --silent && npx vitest run)   #  4 passed
(cd conformance/db       && npm install --silent && npx vitest run)   #  2 passed
```

Some properties are also assessed at review.

One caveat on `conformance/db`: its second test asserts the seat-map query plans to an
index scan. With only 2 230 seed rows a Seq Scan is genuinely cheaper once the planner has
statistics, so `SeedLoader` deliberately does **not** run `ANALYZE` — a manual `ANALYZE seats` or a later autovacuum pass can flip that plan. Re-run
`make seed` before running the suite if the plan has drifted.

## Docker

`Dockerfile` is a two-stage Maven → JRE build serving `:3000` with a `/health` healthcheck.
`migrate`/`seed` read the contract at runtime, so mount the repo's `contract/` at
`/contract` (`CONTRACT_DIR` already points there).
