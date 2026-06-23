import { query } from "../db/pool.js";
import { expireHold } from "../services/ticketforge.js";

/** Background worker: expire active holds past expires_at every second. */
export function startHoldExpiryWorker(intervalMs = 1000): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM holds
         WHERE status = 'active' AND expires_at <= NOW()
         ORDER BY expires_at
         LIMIT 100`
      );
      for (const row of rows) {
        await expireHold(row.id);
      }
    } catch (err) {
      console.error("hold expiry worker error", err);
    }
  };

  void tick();
  return setInterval(tick, intervalMs);
}
