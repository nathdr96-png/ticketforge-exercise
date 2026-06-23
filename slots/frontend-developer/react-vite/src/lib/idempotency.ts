/**
 * Idempotency keys for POST /orders.
 *
 * The contract requires a key of 8..128 characters, and a retry of the *same*
 * checkout must reuse the *same* key so the API can replay the original order
 * (T3-02) instead of charging twice. The key is therefore derived once per hold
 * and kept for as long as that hold is being checked out.
 */

const KEY_PREFIX = "tf-order";

export function newIdempotencyKey(holdId: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${KEY_PREFIX}-${holdId}-${random}`;
  return key.slice(0, 128);
}

export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 8 && key.length <= 128;
}
