/**
 * `Idempotency-Key` for `POST /orders`.
 *
 * The contract wants 8..128 characters, and `contract/scenarios/T3-orders-money.md`
 * (T3-02) wants a retry of the SAME checkout to carry the SAME key, so the API
 * can replay the original order instead of charging twice. On a phone that is
 * not a theoretical concern: a buyer on a train loses the response, not the
 * request, and taps Checkout again.
 *
 * So the key is minted once per (hold, discount code) pair and kept. Changing
 * the code is a different request body and therefore a different purchase,
 * which gets its own key rather than provoking `IDEMPOTENCY_KEY_CONFLICT`. A
 * failed attempt mints nothing — that is the entire point.
 */

const PREFIX = "tf-order";

function randomSuffix(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (crypto && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function mintIdempotencyKey(holdId: string): string {
  return `${PREFIX}-${holdId}-${randomSuffix()}`.slice(0, 128);
}

export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 8 && key.length <= 128;
}
