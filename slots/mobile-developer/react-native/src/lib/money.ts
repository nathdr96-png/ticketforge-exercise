/**
 * Integer-cent money.
 *
 * HARD RULE: nothing on the money path may touch a floating-point number. Every
 * function here takes integer cents, returns integer cents, and divides exactly
 * once, through `floorDiv`, with both operands whole. There is no `/ 100` on a
 * price, no `toFixed`, no `parseFloat`, and no `Number(...)` of a decimal
 * string anywhere in this module — so `4282` cents can only ever read as
 * `42.82`.
 *
 * `assertCents` throws rather than letting a float through. That is deliberate:
 * a crash in a unit test is a cheap way to find a float, and a silent cent of
 * drift in a quoted price is an expensive one.
 *
 * The formulas are `contract/scenarios/T3-orders-money.md`, transcribed:
 *
 *   discount_cents = floor(subtotal * percent_off / 100)
 *   fee_cents      = floor(subtotal_after_discount * 5 / 100) + 30
 *   total_cents    = subtotal_after_discount + fee_cents
 */

import { CURRENCY_SYMBOLS, type Cents } from "./contract";

/** Throws unless `value` is a safe integer. The float trap. */
export function assertCents(value: unknown, label = "amount"): Cents {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, received ${String(value)}`);
  }
  return value;
}

/**
 * `floor(numerator / denominator)` with both operands integers.
 *
 * The single division on the money path. Keeping the operands whole until the
 * division is what stops the result depending on how a binary float represents
 * a percentage: `floorDiv(4050 * 5, 100)` is 202, while `4050 * (5 / 100)` is
 * 202.50000000000003 and rounds to 203.
 */
export function floorDiv(numerator: number, denominator: number): number {
  assertCents(numerator, "numerator");
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`denominator must be a positive integer, received ${String(denominator)}`);
  }
  return Math.floor(numerator / denominator);
}

/** Integer sum. Rejects a non-integer term rather than absorbing it. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) total += assertCents(value, "line amount");
  return total;
}

export const FEE_PERCENT = 5;
export const FEE_FIXED_CENTS = 30;

/** `floor(subtotal * percent_off / 100)`. */
export function discountCents(subtotal: Cents, percentOff: number): Cents {
  assertCents(subtotal, "subtotal");
  if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
    throw new RangeError(`percent_off must be an integer 0..100, received ${String(percentOff)}`);
  }
  return floorDiv(subtotal * percentOff, 100);
}

/** `floor(subtotal_after_discount * 5 / 100) + 30`. Floors — never rounds. */
export function feeCents(subtotalAfterDiscount: Cents): Cents {
  assertCents(subtotalAfterDiscount, "subtotal after discount");
  return floorDiv(subtotalAfterDiscount * FEE_PERCENT, 100) + FEE_FIXED_CENTS;
}

export interface Breakdown {
  subtotal_cents: Cents;
  discount_cents: Cents;
  fee_cents: Cents;
  total_cents: Cents;
}

/**
 * The client-side PREVIEW of the server's order maths, shown before checkout so
 * the buyer can see what a promo code is worth. The `Order` returned by
 * `POST /orders` is always what the confirmation screen renders; this is only
 * the quote, and it has to agree with the server to the cent.
 */
export function previewBreakdown(subtotal: Cents, percentOff = 0): Breakdown {
  const discount = discountCents(subtotal, percentOff);
  const afterDiscount = subtotal - discount;
  const fee = feeCents(afterDiscount);
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    fee_cents: fee,
    total_cents: afterDiscount + fee,
  };
}

/** Thousands separators, inserted digit by digit over a decimal string. */
function group(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * `123456` -> `"1,234.56"`.
 *
 * Assembled from an integer major part and an integer remainder. No division
 * of the amount itself, so there is nothing for a float to round.
 */
export function formatCents(cents: Cents): string {
  assertCents(cents, "cents");
  const negative = cents < 0;
  const absolute = negative ? -cents : cents;
  const major = floorDiv(absolute, 100);
  const minor = absolute - major * 100;
  const minorText = minor < 10 ? `0${minor}` : String(minor);
  return `${negative ? "-" : ""}${group(String(major))}.${minorText}`;
}

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? "";
}

/** `$1,234.56` / `€1,234.56`. */
export function formatMoney(cents: Cents, currency: string): string {
  return `${currencySymbol(currency)}${formatCents(cents)}`;
}
