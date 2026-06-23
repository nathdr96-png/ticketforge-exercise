/**
 * Discount code helpers.
 *
 * TODO(FEAT-30): there is no promo catalogue and no price preview yet. An applied
 * code is passed straight through to POST /orders, so the first time the buyer
 * learns what it was worth is the order confirmation.
 */

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Returns the known percent off, or null when the code is not previewable. */
export function previewPercentOff(_code: string, _eventId: string): number | null {
  return null;
}
