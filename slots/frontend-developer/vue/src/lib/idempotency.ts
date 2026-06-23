/**
 * Idempotency keys for `POST /orders`.
 *
 * The contract wants 8..128 characters, and T3-02 says a retry of the SAME
 * checkout must carry the SAME key so the API replays the original order rather
 * than charging the buyer twice. That makes key lifetime, not key generation,
 * the interesting part: this module only mints one, and the checkout panel is
 * what decides when a new one is due (a new hold, or a different discount code —
 * which is a different request body and would otherwise provoke
 * IDEMPOTENCY_KEY_CONFLICT).
 */

const PREFIX = "tf-order";
const MAX_LENGTH = 128;

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newIdempotencyKey(holdId: string): string {
  return `${PREFIX}-${holdId}-${randomSuffix()}`.slice(0, MAX_LENGTH);
}

export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 8 && key.length <= MAX_LENGTH;
}
