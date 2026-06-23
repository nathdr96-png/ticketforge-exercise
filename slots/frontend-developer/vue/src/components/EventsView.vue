<script setup lang="ts">
/**
 * The paginated event list.
 *
 * `events-page` publishes the whole page state as machine-readable attributes —
 * `data-page`, `data-page-count`, `data-page-size` — because a conformance suite
 * that has to parse "Page 2 of 3" out of a sentence is a suite that breaks on
 * copy changes. The page size is a real control whose value is the `page_size`
 * sent to the API, not a cosmetic dropdown.
 */
import { computed, ref, watch } from "vue";

import { api } from "../lib/api";
import { DEFAULT_EVENT_PAGE_SIZE, EVENT_PAGE_SIZES, type Paged, type TfEvent } from "../lib/contract";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { navigate } from "../lib/router";
import { requireToken } from "../stores/session";
import ErrorBanner from "./ErrorBanner.vue";

const page = ref(1);
const pageSize = ref<number>(DEFAULT_EVENT_PAGE_SIZE);
const result = ref<Paged<TfEvent> | null>(null);
const loading = ref(true);
const error = ref<DisplayError | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    result.value = await api.listEvents(requireToken(), page.value, pageSize.value);
  } catch (cause) {
    error.value = toDisplayError(cause);
  } finally {
    loading.value = false;
  }
}

// A smaller page size can leave the buyer on a page that no longer exists, so
// resizing always returns to page 1 rather than showing an empty list.
watch(pageSize, () => {
  page.value = 1;
});
watch([page, pageSize], () => void load(), { immediate: true });

const total = computed(() => result.value?.total ?? 0);
/** What the API actually paged by, which is the number the suite reads back. */
const effectivePageSize = computed(() => result.value?.page_size ?? pageSize.value);
const shownPage = computed(() => result.value?.page ?? page.value);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / Math.max(1, effectivePageSize.value))),
);

function startsAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function open(eventId: string): void {
  navigate({ name: "event", eventId });
}
</script>

<template>
  <main class="page">
    <div class="page__header">
      <h1 class="page__title">Events</h1>
      <p class="page__meta" data-testid="event-total" :data-total="total">
        {{ total }} event{{ total === 1 ? "" : "s" }}
      </p>
      <label class="field field--inline">
        <span class="field__label">Per page</span>
        <select v-model="pageSize" class="field__input" data-testid="events-page-size">
          <option v-for="size in EVENT_PAGE_SIZES" :key="size" :value="size">
            {{ size }} per page
          </option>
        </select>
      </label>
    </div>

    <ErrorBanner :error="error" @dismiss="error = null" />

    <!-- The container renders unconditionally so the list is addressable while
         the first request is still in flight. -->
    <section class="event-list" data-testid="event-list" :aria-busy="loading">
      <article
        v-for="item in result?.data ?? []"
        :key="item.id"
        class="card event-card"
        data-testid="event-card"
        :data-event-id="item.id"
        role="button"
        tabindex="0"
        @click="open(item.id)"
        @keydown.enter.prevent="open(item.id)"
        @keydown.space.prevent="open(item.id)"
      >
        <div class="event-card__main">
          <h2 class="event-card__title">{{ item.title }}</h2>
          <p class="event-card__venue">{{ item.venue }} &middot; {{ startsAt(item.starts_at) }}</p>
          <p v-if="item.description" class="event-card__desc">{{ item.description }}</p>
        </div>
        <div class="event-card__side">
          <span class="badge" :class="`badge--${item.status}`">{{ item.status }}</span>
          <span class="event-card__price">
            from {{ formatMoney(item.base_price_cents, item.currency) }}
          </span>
          <span class="event-card__seats">{{ item.seat_count }} seats</span>
        </div>
      </article>
      <p v-if="!loading && result && result.data.length === 0" class="empty" data-testid="event-list-empty">
        No events to show.
      </p>
      <p v-if="loading && !result" class="empty">Loading events&hellip;</p>
    </section>

    <div class="pagination">
      <button
        class="button"
        type="button"
        data-testid="events-prev"
        :disabled="shownPage <= 1 || loading"
        @click="page = Math.max(1, page - 1)"
      >
        Previous
      </button>
      <span
        class="pagination__label"
        data-testid="events-page"
        :data-page="shownPage"
        :data-page-count="pageCount"
        :data-page-size="effectivePageSize"
      >
        Page {{ shownPage }} of {{ pageCount }}
      </span>
      <button
        class="button"
        type="button"
        data-testid="events-next"
        :disabled="shownPage >= pageCount || loading"
        @click="page = Math.min(pageCount, page + 1)"
      >
        Next
      </button>
    </div>
  </main>
</template>
