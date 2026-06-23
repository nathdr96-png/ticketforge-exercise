/**
 * Integer-cent money.
 *
 * HARD RULE: nothing on the money path may touch floating point. Every function
 * here takes integers, returns integers, and builds its display string by hand
 * out of two integers — so `4282` cents can only ever render as `42.82`. There
 * is no `/ 100`, no `toFixed`, and no `Number.parseFloat` anywhere below, and
 * `assertCents` throws rather than quietly rounding a float that slipped in from
 * somewhere else.
 *
 * The three formulas are copied verbatim from
 * contract/scenarios/T3-orders-money.md:
 *
 *   discount_cents = floor(subtotal * percent_off / 100)
 *   fee_cents      = floor(subtotal_after_discount * 5 / 100) + 30
 *   total_cents    = (subtotal - discount_cents) + fee_cents
 */

import type { Cents, Currency } from "./contract";

/** fee = floor(after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS. */
export const FEE_PERCENT = 5;
export const FEE_FIXED_CENTS = 30;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/**
 * floor(numerator / denominator), the only division allowed on the money path.
 *
 * Both arguments stay whole: `a * percent` is computed first and divided once,
 * which is why the result never depends on how a binary float rounds a
 * percentage like 0.05.
 */
export function divFloor(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator)) {
    throw new TypeError(`divFloor numerator must be a safe integer, got ${String(numerator)}`);
  }
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new RangeError(`divFloor denominator must be a positive integer, got ${denominator}`);
  }
  return Math.floor(numerator / denominator);
}

/** Throws unless `value` is a safe integer number of cents. */
export function assertCents(value: unknown, what = "amount"): Cents {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${what} must be an integer number of cents, got ${String(value)}`);
  }
  return value;
}

/** Integer sum. Rejects any element that is not already integer cents. */
export function sumCents(amounts: Iterable<Cents>): Cents {
  let total = 0;
  for (const amount of amounts) total += assertCents(amount, "seat price");
  return total;
}

export function currencySymbol(currency: Currency | string): string {
  return CURRENCY_SYMBOLS[currency] ?? "";
}

/** Thousands separators, inserted digit by digit into the major-unit string. */
function group(majorDigits: string): string {
  const out: string[] = [];
  for (let i = 0; i < majorDigits.length; i += 1) {
    if (i > 0 && (majorDigits.length - i) % 3 === 0) out.push(",");
    out.push(majorDigits[i]);
  }
  return out.join("");
}

/**
 * `123456` -> `"1,234.56"`. Integer split plus string building: the minor units
 * are a remainder, so they can never gain or lose a cent in formatting.
 */
export function formatCents(cents: Cents): string {
  assertCents(cents, "cents");
  const negative = cents < 0;
  const magnitude = negative ? -cents : cents;
  const minor = magnitude % 100;
  const major = (magnitude - minor) / 100;
  const minorDigits = minor < 10 ? `0${minor}` : `${minor}`;
  return `${negative ? "-" : ""}${group(`${major}`)}.${minorDigits}`;
}

/** `"$1,234.56"` / `"€1,234.56"`. */
export function formatMoney(cents: Cents, currency: Currency | string): string {
  return `${currencySymbol(currency)}${formatCents(cents)}`;
}

/** contract/scenarios/T3-orders-money.md: floor(subtotal * percent_off / 100). */
export function discountCents(subtotalCents: Cents, percentOff: number): Cents {
  assertCents(subtotalCents, "subtotal");
  if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
    throw new RangeError(`percent_off must be an integer 0..100, got ${percentOff}`);
  }
  return divFloor(subtotalCents * percentOff, 100);
}

/**
 * contract/scenarios/T3-orders-money.md:
 *   fee_cents = floor(subtotal_after_discount * 5 / 100) + 30
 */
export function feeCents(subtotalAfterDiscountCents: Cents): Cents {
  assertCents(subtotalAfterDiscountCents, "subtotal after discount");
  return divFloor(subtotalAfterDiscountCents * FEE_PERCENT, 100) + FEE_FIXED_CENTS;
}

export interface Breakdown {
  subtotal_cents: Cents;
  discount_cents: Cents;
  fee_cents: Cents;
  total_cents: Cents;
}

export const ZERO_BREAKDOWN: Breakdown = {
  subtotal_cents: 0,
  discount_cents: 0,
  fee_cents: 0,
  total_cents: 0,
};

/**
 * Client-side PREVIEW of the order the API will create, so the buyer can see
 * what a promo code is worth before committing. The `Order` returned
 * by `POST /orders` is always the authority once the order exists; this exists
 * only to put the same numbers on screen one step earlier.
 */
export function previewBreakdown(subtotalCents: Cents, percentOff = 0): Breakdown {
  assertCents(subtotalCents, "subtotal");
  // Nothing selected is not a 30c order: show an empty panel rather than a fee
  // on a purchase that does not exist.
  if (subtotalCents === 0) return { ...ZERO_BREAKDOWN };
  const discount = discountCents(subtotalCents, percentOff);
  const afterDiscount = subtotalCents - discount;
  const fee = feeCents(afterDiscount);
  return {
    subtotal_cents: subtotalCents,
    discount_cents: discount,
    fee_cents: fee,
    total_cents: afterDiscount + fee,
  };
}
