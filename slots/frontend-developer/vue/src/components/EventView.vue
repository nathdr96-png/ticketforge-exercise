<script setup lang="ts">
/**
 * One event: the seat map, the selection, the hold, and checkout.
 *
 * The whole seat map is loaded once into `seats` and every filter is applied in
 * memory over that snapshot, so changing a filter costs no round trip. The
 * snapshot is a `shallowRef` deliberately: a deep reactive proxy over 2,000 seat
 * objects would be 2,000 proxies to build, and nothing here ever mutates a seat
 * in place — a refresh REPLACES the array, which is the only way a shallow ref
 * notifies anybody.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";

import { api, ApiError } from "../lib/api";
import {
  ALL_SEAT_STATUSES,
  ALL_SECTIONS,
  MAX_SEATS_PER_HOLD,
  type Hold,
  type Order,
  type Seat,
  type SeatStatus,
  type Section,
  type TfEvent,
} from "../lib/contract";
import { normaliseCode, previewPercentOff } from "../lib/discounts";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { newIdempotencyKey } from "../lib/idempotency";
import { formatMoney, previewBreakdown, sumCents } from "../lib/money";
import { hrefFor, navigate } from "../lib/router";
import { requireToken, useSession } from "../stores/session";
import ErrorBanner from "./ErrorBanner.vue";
import HoldCountdown from "./HoldCountdown.vue";
import MoneyBreakdown from "./MoneyBreakdown.vue";
import SeatMap from "./SeatMap.vue";

const props = defineProps<{ eventId: string }>();
const { rememberOrder } = useSession();

const event = shallowRef<TfEvent | null>(null);
const seats = shallowRef<Seat[] | null>(null);
const loading = ref(true);
const error = ref<DisplayError | null>(null);

const section = ref<"" | Section>("");
const availability = ref<"" | SeatStatus>("");

const selected = ref<Set<string>>(new Set<string>());
const hold = shallowRef<Hold | null>(null);
const holdExpired = ref(false);
const order = shallowRef<Order | null>(null);
const busy = ref<null | "hold" | "release" | "checkout">(null);

const discountInput = ref("");
const appliedCode = ref<string | null>(null);
const idempotencyKey = ref("");

let inflight: AbortController | null = null;

/**
 * One key per (hold, discount code) pair.
 *
 * Minted when a hold appears and whenever the discount code changes — a
 * different code is a different request body, and reusing the key for it would
 * earn an IDEMPOTENCY_KEY_CONFLICT. Deliberately NOT minted on a failed
 * checkout: retrying the same purchase has to send the same key or the API
 * cannot recognise the retry and the buyer is charged twice (T3-02).
 */
function mintIdempotencyKey(): void {
  idempotencyKey.value = hold.value ? newIdempotencyKey(hold.value.id) : "";
}

async function refreshSeats(): Promise<void> {
  try {
    seats.value = await api.listAllSeats(requireToken(), props.eventId);
  } catch {
    /* the error from the action the buyer just took is the more useful one */
  }
}

async function loadEvent(eventId: string): Promise<void> {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;

  loading.value = true;
  error.value = null;
  event.value = null;
  seats.value = null;
  selected.value = new Set<string>();
  hold.value = null;
  order.value = null;
  holdExpired.value = false;
  appliedCode.value = null;
  discountInput.value = "";
  idempotencyKey.value = "";

  const token = requireToken();
  try {
    const [loadedEvent, loadedSeats] = await Promise.all([
      api.getEvent(token, eventId, controller.signal),
      api.listAllSeats(token, eventId, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    event.value = loadedEvent;
    seats.value = loadedSeats;
  } catch (cause) {
    if (!controller.signal.aborted) error.value = toDisplayError(cause);
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

watch(() => props.eventId, (id) => void loadEvent(id), { immediate: true });
onBeforeUnmount(() => inflight?.abort());

const seatsById = computed(() => {
  const index = new Map<string, Seat>();
  for (const seat of seats.value ?? []) index.set(seat.id, seat);
  return index;
});

/**
 * The visible seats: both filters must hold at once, and an unset filter simply
 * drops out of the predicate.
 */
const visibleSeats = computed<Seat[]>(() => {
  const all = seats.value ?? [];
  if (!section.value && !availability.value) return all;
  return all.filter(
    (seat) =>
      (!section.value || seat.section === section.value) &&
      (!availability.value || seat.status === availability.value),
  );
});

const counts = computed(() => {
  const tally = { available: 0, held: 0, sold: 0, total: 0 };
  for (const seat of seats.value ?? []) {
    tally[seat.status] += 1;
    tally.total += 1;
  }
  return tally;
});

const selectedSeats = computed<Seat[]>(() => {
  const index = seatsById.value;
  const picked: Seat[] = [];
  for (const id of selected.value) {
    const seat = index.get(id);
    if (seat) picked.push(seat);
  }
  return picked;
});

const subtotalCents = computed(() => sumCents(selectedSeats.value.map((seat) => seat.price_cents)));

/** The percent off we can show locally, or null when only the API can judge it. */
const previewPercent = computed(() =>
  appliedCode.value ? previewPercentOff(appliedCode.value, props.eventId) : null,
);
const preview = computed(() => previewBreakdown(subtotalCents.value, previewPercent.value ?? 0));

const currency = computed(() => event.value?.currency ?? "USD");
const locked = computed(() => Boolean(hold.value) || Boolean(order.value));
const previewNote = computed(() => {
  if (appliedCode.value && previewPercent.value === null) {
    return `Code ${appliedCode.value} will be checked by the server when the order is placed.`;
  }
  return "Fee = floor(subtotal after discount × 5%) + 30. The API confirms the final amounts.";
});

function toggleSeat(seatId: string): void {
  error.value = null;
  const next = new Set(selected.value);
  if (next.has(seatId)) next.delete(seatId);
  else if (next.size < MAX_SEATS_PER_HOLD) next.add(seatId);
  selected.value = next;
}

async function placeHold(): Promise<void> {
  if (selected.value.size === 0 || busy.value) return;
  busy.value = "hold";
  error.value = null;
  try {
    hold.value = await api.createHold(requireToken(), props.eventId, [...selected.value]);
    holdExpired.value = false;
    order.value = null;
    mintIdempotencyKey();
    await refreshSeats();
  } catch (cause) {
    error.value = toDisplayError(cause);
  } finally {
    busy.value = null;
  }
}

async function releaseHold(): Promise<void> {
  const current = hold.value;
  if (!current || busy.value) return;
  busy.value = "release";
  error.value = null;
  try {
    await api.releaseHold(requireToken(), current.id);
    hold.value = null;
    holdExpired.value = false;
    selected.value = new Set<string>();
    mintIdempotencyKey();
  } catch (cause) {
    error.value = toDisplayError(cause);
  } finally {
    // The seats are the server's answer either way: a release that failed must
    // not leave them drawn as free.
    await refreshSeats();
    busy.value = null;
  }
}

async function checkout(): Promise<void> {
  const current = hold.value;
  if (!current || busy.value) return;
  busy.value = "checkout";
  error.value = null;
  try {
    const created = await api.createOrder(
      requireToken(),
      idempotencyKey.value,
      current.id,
      appliedCode.value,
    );
    order.value = created;
    rememberOrder(created.id);
    hold.value = null;
    selected.value = new Set<string>();
    idempotencyKey.value = "";
    await refreshSeats();
  } catch (cause) {
    // The hold and the key both SURVIVE a failed charge: a rejected discount code
    // or a transient 500 must leave the buyer able to retry the same purchase,
    // and a retry with a fresh key would be a second charge.
    error.value = toDisplayError(cause);
    if (cause instanceof ApiError && cause.code === "HOLD_EXPIRED") holdExpired.value = true;
  } finally {
    busy.value = null;
  }
}

function applyDiscount(): void {
  const code = normaliseCode(discountInput.value);
  error.value = null;
  appliedCode.value = code || null;
  mintIdempotencyKey();
}

function clearDiscount(): void {
  discountInput.value = "";
  appliedCode.value = null;
  error.value = null;
  mintIdempotencyKey();
}

function startOver(): void {
  order.value = null;
  appliedCode.value = null;
  discountInput.value = "";
  idempotencyKey.value = "";
}

function eventStartsAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function seatLabel(seat: Seat): string {
  return `${seat.section}${seat.row}-${String(seat.number).padStart(2, "0")}`;
}
</script>

<template>
  <main class="page">
    <div class="page__header">
      <div>
        <a class="backlink" :href="hrefFor({ name: 'events' })">&larr; All events</a>
        <h1 class="page__title" data-testid="event-title" :data-event-id="eventId">
          {{ event?.title ?? (loading ? "Loading event…" : eventId) }}
        </h1>
        <p v-if="event" class="page__meta">
          {{ event.venue }} &middot; {{ eventStartsAt(event.starts_at) }} &middot;
          {{ event.seat_count }} seats &middot; {{ event.currency }}
        </p>
      </div>
    </div>

    <ErrorBanner :error="error" @dismiss="error = null" />

    <div class="event-layout">
      <section class="card seat-panel">
        <div class="seat-panel__toolbar">
          <label class="field field--inline">
            <span class="field__label">Section</span>
            <select v-model="section" class="field__input" data-testid="filter-section">
              <option value="">All sections</option>
              <option v-for="letter in ALL_SECTIONS" :key="letter" :value="letter">
                Section {{ letter }}
              </option>
            </select>
          </label>
          <label class="field field--inline">
            <span class="field__label">Availability</span>
            <select v-model="availability" class="field__input" data-testid="filter-availability">
              <option value="">Any status</option>
              <option v-for="status in ALL_SEAT_STATUSES" :key="status" :value="status">
                {{ status }}
              </option>
            </select>
          </label>
          <span class="seat-panel__counts" data-testid="seat-counts">
            <span data-testid="seat-count-visible">{{ visibleSeats.length }}</span> shown &middot;
            {{ counts.available }} available &middot; {{ counts.held }} held &middot;
            {{ counts.sold }} sold
          </span>
        </div>

        <div class="legend" aria-hidden="true">
          <span class="legend__item"><span class="seat seat--available legend__swatch" /> available</span>
          <span class="legend__item"><span class="seat seat--held legend__swatch" /> held</span>
          <span class="legend__item"><span class="seat seat--sold legend__swatch" /> sold</span>
          <span class="legend__item"><span class="seat seat--selected legend__swatch" /> selected</span>
        </div>

        <p v-if="seats === null" class="empty" data-testid="seat-map-loading">
          Loading seat map&hellip;
        </p>
        <SeatMap
          v-else
          :seats="visibleSeats"
          :selected="selected"
          :locked="locked"
          :selection-full="selected.size >= MAX_SEATS_PER_HOLD"
          @toggle="toggleSeat"
        />
      </section>

      <aside class="card checkout">
        <h2 class="checkout__title">Your seats</h2>

        <!-- ---------------------------- confirmed order ---------------------------- -->
        <div
          v-if="order"
          class="confirmation"
          data-testid="order-confirmation"
          :data-order-id="order.id"
        >
          <p class="confirmation__headline">Order confirmed</p>
          <p class="confirmation__id">Order <code>{{ order.id }}</code> &middot; {{ order.status }}</p>
          <p class="confirmation__seats">
            {{ order.seat_ids.length }} seat{{ order.seat_ids.length === 1 ? "" : "s" }}:
            {{ order.seat_ids.join(", ") }}
          </p>
          <MoneyBreakdown
            prefix="order"
            :subtotal-cents="order.subtotal_cents"
            :discount-cents="order.discount_cents"
            :fee-cents="order.fee_cents"
            :total-cents="order.total_cents"
            :currency="order.currency"
            :note="order.discount_code ? `Discount code ${order.discount_code} applied.` : undefined"
          />
          <div class="checkout__actions">
            <button class="button" type="button" data-testid="order-new" @click="startOver">
              Buy more seats
            </button>
            <button
              class="button button--ghost"
              type="button"
              @click="navigate({ name: 'orders' })"
            >
              View orders
            </button>
          </div>
        </div>

        <!-- --------------------------- selection + hold --------------------------- -->
        <template v-else>
          <ul class="selection" data-testid="selection-list">
            <li v-if="selectedSeats.length === 0" class="empty">
              Pick an available seat on the map.
            </li>
            <li
              v-for="seat in selectedSeats"
              :key="seat.id"
              class="selection__item"
              :data-seat-id="seat.id"
            >
              <span>{{ seatLabel(seat) }}</span>
              <span :data-cents="seat.price_cents">
                {{ formatMoney(seat.price_cents, currency) }}
              </span>
            </li>
          </ul>

          <MoneyBreakdown
            prefix="checkout"
            :subtotal-cents="preview.subtotal_cents"
            :discount-cents="preview.discount_cents"
            :fee-cents="preview.fee_cents"
            :total-cents="preview.total_cents"
            :currency="currency"
            :note="previewNote"
          />

          <div class="discount">
            <label class="field field--inline">
              <span class="field__label">Discount code</span>
              <input
                v-model="discountInput"
                class="field__input"
                data-testid="discount-code"
                placeholder="SAVE10"
              />
            </label>
            <button
              class="button"
              type="button"
              data-testid="discount-apply"
              :disabled="discountInput.trim().length === 0"
              @click="applyDiscount"
            >
              Apply
            </button>
            <button
              v-if="appliedCode"
              class="button button--ghost"
              type="button"
              data-testid="discount-clear"
              @click="clearDiscount"
            >
              Remove
            </button>
          </div>
          <p
            v-if="appliedCode"
            class="discount__applied"
            data-testid="discount-applied"
            :data-code="appliedCode"
          >
            {{ appliedCode }} applied{{
              previewPercent !== null ? ` — ${previewPercent}% off subtotal` : ""
            }}
          </p>

          <template v-if="hold">
            <HoldCountdown :expires-at="hold.expires_at" @expired="holdExpired = true" />
            <p class="hold__meta" data-testid="hold-id" :data-hold-id="hold.id">
              Hold <code>{{ hold.id }}</code> &middot; {{ hold.seat_ids.length }} seat{{
                hold.seat_ids.length === 1 ? "" : "s"
              }}
            </p>
            <input
              type="hidden"
              data-testid="idempotency-key"
              :value="idempotencyKey"
              readonly
            />
            <div class="checkout__actions">
              <button
                class="button button--primary"
                type="button"
                data-testid="checkout-button"
                :disabled="busy !== null || holdExpired"
                @click="checkout"
              >
                {{ busy === "checkout" ? "Placing order…" : "Checkout" }}
              </button>
              <button
                class="button"
                type="button"
                data-testid="release-button"
                :disabled="busy !== null"
                @click="releaseHold"
              >
                {{ busy === "release" ? "Releasing…" : "Release hold" }}
              </button>
            </div>
            <p class="checkout__key">Idempotency-Key: <code>{{ idempotencyKey }}</code></p>
          </template>
          <button
            v-else
            class="button button--primary"
            type="button"
            data-testid="hold-button"
            :disabled="selected.size === 0 || busy !== null"
            @click="placeHold"
          >
            {{
              busy === "hold"
                ? "Holding…"
                : selected.size === 0
                  ? "Hold seats"
                  : `Hold ${selected.size} seat${selected.size === 1 ? "" : "s"}`
            }}
          </button>
        </template>
      </aside>
    </div>
  </main>
</template>
