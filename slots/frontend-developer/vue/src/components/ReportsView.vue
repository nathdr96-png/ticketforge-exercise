<script setup lang="ts">
/**
 * Organizer / admin revenue report.
 *
 * Authorization is the API's call, not this component's: `GET /reports/revenue`
 * is requested unconditionally, and a buyer who reaches `#/reports` by typing
 * the URL gets the contract's `INSUFFICIENT_PERMISSION` in the error banner and
 * no numbers at all. Hiding `nav-reports` (NavBar.vue) is a courtesy; this is the
 * part that actually holds.
 */
import { onMounted, ref } from "vue";

import { api } from "../lib/api";
import type { RevenueReport } from "../lib/contract";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { requireToken, useSession } from "../stores/session";
import ErrorBanner from "./ErrorBanner.vue";

const { user, canSeeReports } = useSession();
const report = ref<RevenueReport | null>(null);
const loading = ref(true);
const error = ref<DisplayError | null>(null);

onMounted(async () => {
  try {
    report.value = await api.revenueReport(requireToken());
  } catch (cause) {
    report.value = null;
    error.value = toDisplayError(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="page">
    <div class="page__header">
      <h1 class="page__title">Revenue</h1>
      <p class="page__meta">{{ user?.email }} &middot; {{ user?.role }}</p>
    </div>

    <ErrorBanner :error="error" @dismiss="error = null" />

    <p v-if="!canSeeReports && !error" class="empty" data-testid="revenue-forbidden">
      Revenue reporting is available to organizers and admins only.
    </p>
    <p v-if="loading" class="empty">Loading revenue&hellip;</p>

    <section
      v-if="report"
      class="card revenue"
      data-testid="revenue-report"
      :data-currency="report.currency"
    >
      <div class="revenue__totals">
        <div class="stat">
          <span class="stat__label">Gross</span>
          <span class="stat__value" data-testid="revenue-gross" :data-cents="report.gross_cents">
            {{ formatMoney(report.gross_cents, report.currency) }}
          </span>
        </div>
        <div class="stat">
          <span class="stat__label">Fees</span>
          <span class="stat__value" data-testid="revenue-fees" :data-cents="report.fees_cents">
            {{ formatMoney(report.fees_cents, report.currency) }}
          </span>
        </div>
        <div class="stat">
          <span class="stat__label">Discounts</span>
          <span
            class="stat__value"
            data-testid="revenue-discounts"
            :data-cents="report.discounts_cents"
          >
            {{ formatMoney(report.discounts_cents, report.currency) }}
          </span>
        </div>
        <div class="stat">
          <span class="stat__label">Net</span>
          <span class="stat__value" data-testid="revenue-net" :data-cents="report.net_cents">
            {{ formatMoney(report.net_cents, report.currency) }}
          </span>
        </div>
      </div>

      <table class="revenue__table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Orders</th>
            <th>Gross</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="report.by_event.length === 0">
            <td colspan="4" class="empty">No orders in range yet.</td>
          </tr>
          <tr
            v-for="row in report.by_event"
            :key="row.event_id"
            data-testid="revenue-row"
            :data-event-id="row.event_id"
          >
            <td>{{ row.event_id }}</td>
            <td>{{ row.order_count }}</td>
            <td :data-cents="row.gross_cents">{{ formatMoney(row.gross_cents, report.currency) }}</td>
            <td :data-cents="row.net_cents">{{ formatMoney(row.net_cents, report.currency) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
