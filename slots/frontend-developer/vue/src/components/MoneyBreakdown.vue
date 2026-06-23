<script setup lang="ts">
/**
 * Subtotal / discount / fee / total.
 *
 * Every number arrives as integer cents and leaves as two things: the
 * `data-cents` attribute, which is the integer exactly as the API returned it
 * (or exactly as contract/scenarios/T3-orders-money.md computes it for the
 * preview rows), and a formatted string built by `formatMoney` without ever
 * touching a float. The suite reads both and demands they agree.
 *
 * `prefix` selects which half of contract/testids.md this instance exposes:
 * `checkout-*` for the pre-order preview, `order-*` for the confirmed order.
 */
import type { Cents, Currency } from "../lib/contract";
import { formatMoney } from "../lib/money";

const props = defineProps<{
  prefix: "checkout" | "order";
  subtotalCents: Cents;
  discountCents: Cents;
  feeCents: Cents;
  totalCents: Cents;
  currency: Currency | string;
  note?: string;
}>();

function money(cents: Cents): string {
  return formatMoney(cents, props.currency);
}
</script>

<template>
  <dl class="breakdown" :data-testid="`${prefix}-breakdown`">
    <div class="breakdown__row">
      <dt>Subtotal</dt>
      <dd :data-testid="`${prefix}-subtotal`" :data-cents="subtotalCents">
        {{ money(subtotalCents) }}
      </dd>
    </div>
    <div class="breakdown__row">
      <dt>Discount</dt>
      <dd :data-testid="`${prefix}-discount`" :data-cents="discountCents">
        {{ discountCents > 0 ? `−${money(discountCents)}` : money(0) }}
      </dd>
    </div>
    <div class="breakdown__row">
      <dt>Service fee</dt>
      <dd :data-testid="`${prefix}-fee`" :data-cents="feeCents">{{ money(feeCents) }}</dd>
    </div>
    <div class="breakdown__row breakdown__row--total">
      <dt>Total</dt>
      <dd :data-testid="`${prefix}-total`" :data-cents="totalCents">{{ money(totalCents) }}</dd>
    </div>
    <p v-if="note" class="breakdown__note">{{ note }}</p>
  </dl>
</template>
