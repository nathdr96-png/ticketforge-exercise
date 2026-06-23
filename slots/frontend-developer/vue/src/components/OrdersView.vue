<script setup lang="ts">
/**
 * Orders this browser has placed.
 *
 * The contract has no "list my orders" endpoint, so the session remembers the
 * ids it created and each one is re-read with `GET /orders/{id}`.
 *
 * The money rows here deliberately do NOT reuse the `order-*` testids from
 * contract/testids.md: those identify THE confirmed order on the event page, and
 * emitting a set per row would make `order-total` ambiguous for a suite that
 * selects by testid alone.
 */
import { onMounted, ref } from "vue";

import { api } from "../lib/api";
import type { Order } from "../lib/contract";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { requireToken, useSession } from "../stores/session";
import ErrorBanner from "./ErrorBanner.vue";

const { orderIds } = useSession();
const orders = ref<Order[]>([]);
const loading = ref(true);
const error = ref<DisplayError | null>(null);

onMounted(async () => {
  const token = requireToken();
  try {
    const loaded = await Promise.all(
      orderIds.value.map(async (id) => {
        try {
          return await api.getOrder(token, id);
        } catch {
          // An order this browser remembers but the API will not return (a
          // different user, a wiped database) is dropped rather than fatal.
          return null;
        }
      }),
    );
    orders.value = loaded.filter((entry): entry is Order => entry !== null);
  } catch (cause) {
    error.value = toDisplayError(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="page">
    <div class="page__header">
      <h1 class="page__title">Orders</h1>
      <p class="page__meta">
        {{ orders.length }} order{{ orders.length === 1 ? "" : "s" }} in this browser
      </p>
    </div>

    <ErrorBanner :error="error" @dismiss="error = null" />

    <section class="order-list" data-testid="order-list">
      <p v-if="loading" class="empty">Loading orders&hellip;</p>
      <p v-else-if="orders.length === 0" class="empty" data-testid="order-list-empty">
        No orders yet &mdash; hold some seats and check out.
      </p>
      <article
        v-for="item in orders"
        :key="item.id"
        class="card order-card"
        data-testid="order-card"
        :data-order-id="item.id"
      >
        <header class="order-card__header">
          <code>{{ item.id }}</code>
          <span class="badge" :class="`badge--${item.status}`">{{ item.status }}</span>
        </header>
        <p class="order-card__meta">
          {{ item.event_id }} &middot; {{ item.seat_ids.length }} seat{{
            item.seat_ids.length === 1 ? "" : "s"
          }}
        </p>
        <dl class="breakdown">
          <div class="breakdown__row">
            <dt>Subtotal</dt>
            <dd :data-cents="item.subtotal_cents">
              {{ formatMoney(item.subtotal_cents, item.currency) }}
            </dd>
          </div>
          <div class="breakdown__row">
            <dt>Discount</dt>
            <dd :data-cents="item.discount_cents">
              {{ formatMoney(item.discount_cents, item.currency) }}
            </dd>
          </div>
          <div class="breakdown__row">
            <dt>Service fee</dt>
            <dd :data-cents="item.fee_cents">{{ formatMoney(item.fee_cents, item.currency) }}</dd>
          </div>
          <div class="breakdown__row breakdown__row--total">
            <dt>Total</dt>
            <dd :data-cents="item.total_cents">
              {{ formatMoney(item.total_cents, item.currency) }}
            </dd>
          </div>
        </dl>
      </article>
    </section>
  </main>
</template>
