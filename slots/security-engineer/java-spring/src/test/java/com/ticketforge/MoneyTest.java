package com.ticketforge;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.ticketforge.config.Money;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Unit tests for {@link Money}. All arithmetic is integer cents. */
class MoneyTest {

  @Test
  @DisplayName("fee = floor(subtotal * 5 / 100) + 30")
  void feeMath() {
    assertEquals(280L, Money.feeCents(5000L));
    assertEquals(30L, Money.feeCents(0L));
    assertEquals(34L, Money.feeCents(99L));
  }

  @Test
  @DisplayName("fee floors a half-cent remainder instead of rounding it")
  void feeFloorsNeverRounds() {
    // 4050 * 5 / 100 = 202.5 exactly — floor gives 202 (+30 = 232), rounding would give 233.
    assertEquals(232L, Money.feeCents(4050L));
    assertEquals(239L, Money.feeCents(4190L)); // 209.5 -> 209
    assertEquals(30L, Money.feeCents(19L)); // 0.95 -> 0
  }

  @Test
  @DisplayName("discount = floor(subtotal * percent_off / 100)")
  void discountMath() {
    assertEquals(500L, Money.discountCents(5000L, 10L));
    assertEquals(333L, Money.discountCents(3333L, 10L));
    assertEquals(166L, Money.discountCents(1111L, 15L)); // 166.65 -> 166
    assertEquals(0L, Money.discountCents(1234L, 0L));
    assertEquals(1234L, Money.discountCents(1234L, 100L));
  }

  @Test
  @DisplayName("order total identity: (subtotal - discount) + fee")
  void totalIdentity() {
    long subtotal = 7500L;
    long discount = Money.discountCents(subtotal, 10L);
    long fee = Money.feeCents(subtotal - discount);
    assertEquals(750L, discount);
    assertEquals(6750L + Money.feeCents(6750L), Money.totalCents(subtotal, discount, fee));
  }

  @Test
  @DisplayName("the exact figures the conformance suite asserts for a 4500c seat with SAVE10")
  void save10OnA4500CentSeat() {
    long subtotal = 4500L;
    long discount = Money.discountCents(subtotal, 10L);
    long fee = Money.feeCents(subtotal - discount);
    long total = Money.totalCents(subtotal, discount, fee);
    assertEquals(450L, discount);
    assertEquals(232L, fee);
    assertEquals(4282L, total);
  }

  @Test
  @DisplayName("configurable fee parameters still floor")
  void configurableFee() {
    assertEquals(0L, Money.feeCents(199L, 0L, 0L));
    assertEquals(19L, Money.feeCents(199L, 10L, 0L)); // 19.9 -> 19
    assertEquals(1L, Money.feeCents(1L, 100L, 0L));
  }

  @Test
  @DisplayName("revenue identity: net == gross - discounts + fees")
  void revenueIdentity() {
    long[][] orders = {{7000, 10}, {4500, 10}, {5000, 0}, {6000, 20}};
    long gross = 0;
    long discounts = 0;
    long fees = 0;
    long net = 0;
    for (long[] o : orders) {
      long subtotal = o[0];
      long discount = Money.discountCents(subtotal, o[1]);
      long fee = Money.feeCents(subtotal - discount);
      gross += subtotal;
      discounts += discount;
      fees += fee;
      net += Money.totalCents(subtotal, discount, fee);
    }
    assertEquals(gross - discounts + fees, net);
  }
}
