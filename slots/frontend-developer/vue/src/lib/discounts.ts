/**
 * Discount code helpers.
 *
 * TODO(FEAT-30): there is no promo catalogue and no local price preview yet. An
 * applied code is forwarded to POST /orders as typed, so the first time the
 * buyer learns what it was worth is the order confirmation.
 */

/** A typed promo code in the canonical form the contract stores codes in. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** The percent off we can preview locally, or null when we cannot price it. */
export function previewPercentOff(_code: string, _eventId: string): number | null {
  return null;
}
