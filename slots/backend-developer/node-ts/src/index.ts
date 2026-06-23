import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { registerRoutes } from "./routes/index.js";
import { getRedis } from "./services/ticketforge.js";
import { startHoldExpiryWorker } from "./workers/holdExpiry.js";

async function main() {
  const app = Fastify({ logger: { level: config.logLevel } });
  await app.register(cors, { origin: true });
  await registerRoutes(app);

  // Warm Redis connection (non-fatal if Redis is down — Postgres locking remains authoritative)
  try {
    await getRedis().connect();
  } catch (err) {
    app.log.warn({ err }, "Redis unavailable at startup; continuing with Postgres locks only");
  }

  const worker = startHoldExpiryWorker(1000);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`TicketForge API on :${config.port}`);

  const shutdown = async () => {
    clearInterval(worker);
    await app.close();
    await pool.end();
    try {
      getRedis().disconnect();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
