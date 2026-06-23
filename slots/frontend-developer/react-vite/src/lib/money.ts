/**
 * Integer-cent money helpers.
 *
 * HARD RULE (contract/errors.md): the money path never touches floating point.
 * Everything here works on integers and builds the display string by hand, so
 * `1999` cents can only ever render as `19.99` — no `/ 100` rounding drift and
 * no `toFixed` on a float that already lost precision.
 */

import type { Currency, MoneyCents } from "./contract";

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? "";
}

/** Throws unless `value` is a safe integer — guards against float leakage. */
export function assertIntegerCents(value: unknown, label = "amount"): MoneyCents {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, got ${String(value)}`);
  }
  return value;
}

/** Integer addition over a list of cent amounts. */
export function sumCents(values: readonly MoneyCents[]): MoneyCents {
  let total = 0;
  for (const value of values) total += assertIntegerCents(value, "seat price");
  return total;
}

/** Group the major units with thousands separators, digit by digit. */
function groupDigits(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * `123456` -> `1,234.56`. Pure integer math + string building.
 * Negative amounts render with a leading minus sign.
 */
export function formatCents(cents: MoneyCents): string {
  assertIntegerCents(cents, "cents");
  const negative = cents < 0;
  const abs = negative ? -cents : cents;
  const major = (abs - (abs % 100)) / 100;
  const minor = abs % 100;
  const minorStr = minor < 10 ? `0${minor}` : String(minor);
  return `${negative ? "-" : ""}${groupDigits(String(major))}.${minorStr}`;
}

/** `$1,234.56` / `€1,234.56`. */
export function formatMoney(cents: MoneyCents, currency: Currency | string): string {
  return `${currencySymbol(currency)}${formatCents(cents)}`;
}

/**
 * contract/scenarios/T3-orders-money.md:
 *   discount_cents = floor(subtotal * percent_off / 100)
 * Integer math only.
 */
export function discountCents(subtotalCents: MoneyCents, percentOff: number): MoneyCents {
  assertIntegerCents(subtotalCents, "subtotal");
  if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
    throw new RangeError(`percent_off must be an integer 0..100, got ${percentOff}`);
  }
  return Math.floor((subtotalCents * percentOff) / 100);
}

/**
 * contract/scenarios/T3-orders-money.md:
 *   fee_cents = floor(subtotal_after_discount * 5 / 100) + 30
 */
export const FEE_PERCENT = 5;
export const FEE_FIXED_CENTS = 30;

export function feeCents(
  subtotalAfterDiscountCents: MoneyCents,
  feePercent: number = FEE_PERCENT,
  feeFixed: MoneyCents = FEE_FIXED_CENTS,
): MoneyCents {
  assertIntegerCents(subtotalAfterDiscountCents, "subtotal after discount");
  return Math.floor((subtotalAfterDiscountCents * feePercent) / 100) + feeFixed;
}

export interface MoneyBreakdown {
  subtotal_cents: MoneyCents;
  discount_cents: MoneyCents;
  fee_cents: MoneyCents;
  total_cents: MoneyCents;
}

/**
 * Client-side *preview* of the server's order maths, used before checkout so the
 * buyer can see what applying a discount code does. The order response from the
 * API is always authoritative once the order exists.
 *
 *   total_cents = (subtotal - discount) + fee
 */
export function previewBreakdown(
  subtotalCents: MoneyCents,
  percentOff = 0,
): MoneyBreakdown {
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
