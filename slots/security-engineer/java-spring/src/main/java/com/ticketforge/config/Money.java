package com.ticketforge.config;

/**
 * Money math. All amounts are integer minor units (cents) held in {@code long}.
 * Never {@code double}/{@code float} — see contract/errors.md "Money & time invariants".
 *
 * <pre>
 *   discount_cents = floor(subtotal * percent_off / 100)
 *   fee_cents      = floor(subtotal_after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS
 *   total_cents    = (subtotal - discount) + fee
 * </pre>
 */
public final class Money {

  private Money() {}

  /** fee_cents = floor(subtotalAfterDiscount * feePercent / 100) + feeFixedCents. */
  public static long feeCents(long subtotalAfterDiscount, long feePercent, long feeFixedCents) {
    return Math.floorDiv(subtotalAfterDiscount * feePercent, 100L) + feeFixedCents;
  }

  /** Canonical defaults (FEE_PERCENT=5, FEE_FIXED_CENTS=30). */
  public static long feeCents(long subtotalAfterDiscount) {
    return feeCents(subtotalAfterDiscount, 5L, 30L);
  }

  /** discount_cents = floor(subtotal * percentOff / 100). */
  public static long discountCents(long subtotal, long percentOff) {
    return Math.floorDiv(subtotal * percentOff, 100L);
  }

  /** total_cents = (subtotal - discount) + fee. */
  public static long totalCents(long subtotal, long discount, long fee) {
    return (subtotal - discount) + fee;
  }
}
