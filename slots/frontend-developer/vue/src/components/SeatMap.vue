<script setup lang="ts">
/**
 * The seat map: up to 2,000 seats, all of them in the DOM.
 *
 * Every seat is a plain `<button>` emitted straight from this component's
 * template rather than a child component per seat. 2,000 component instances is
 * 2,000 reactive scopes to create and tear down on every filter change; 2,000
 * elements in one render function is a single pass. The expensive half of a map
 * this size is layout and paint, so the rows opt into `content-visibility: auto`
 * in styles.css and the browser skips everything scrolled out of view.
 *
 * contract/testids.md: each seat carries `data-seat-id`, `data-section` and
 * `data-status`, and an available seat additionally carries the `seat-available`
 * marker.
 */
import { computed } from "vue";

import type { Seat, Section } from "../lib/contract";
import { formatCents } from "../lib/money";

const props = defineProps<{
  seats: readonly Seat[];
  /** Seat ids the buyer has picked but not yet held. */
  selected: ReadonlySet<string>;
  /** A hold or an order exists: the map is read-only until it is released. */
  locked: boolean;
  /** The 10-seats-per-hold ceiling is reached; further seats cannot be added. */
  selectionFull: boolean;
}>();

defineEmits<{ toggle: [seatId: string] }>();

interface RowGroup {
  key: string;
  row: string;
  seats: Seat[];
}
interface SectionGroup {
  section: Section;
  rows: RowGroup[];
}

/** Section, then row, then seat number — the order the API already returns. */
const groups = computed<SectionGroup[]>(() => {
  const bySection = new Map<Section, Map<string, Seat[]>>();
  for (const seat of props.seats) {
    let rows = bySection.get(seat.section);
    if (!rows) {
      rows = new Map<string, Seat[]>();
      bySection.set(seat.section, rows);
    }
    const row = rows.get(seat.row);
    if (row) row.push(seat);
    else rows.set(seat.row, [seat]);
  }
  return [...bySection.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, rows]) => ({
      section,
      rows: [...rows.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([row, rowSeats]) => ({
          key: `${section}-${row}`,
          row,
          seats: rowSeats.slice().sort((a, b) => a.number - b.number),
        })),
    }));
});

function label(seat: Seat): string {
  return `${seat.section}${seat.row}-${String(seat.number).padStart(2, "0")}`;
}

function isSelected(seat: Seat): boolean {
  return props.selected.has(seat.id);
}

/** A seat is clickable only while it is free and the panel is not committed. */
function isDisabled(seat: Seat): boolean {
  if (isSelected(seat)) return false;
  return props.locked || seat.status !== "available" || props.selectionFull;
}
</script>

<template>
  <div class="seat-map" data-testid="seat-map" :data-seat-count="seats.length">
    <p v-if="groups.length === 0" class="empty" data-testid="seat-map-empty">
      No seats match these filters.
    </p>
    <section v-for="group in groups" :key="group.section" class="seat-section">
      <h3 class="seat-section__title">Section {{ group.section }}</h3>
      <div v-for="row in group.rows" :key="row.key" class="seat-row">
        <span class="seat-row__label">{{ row.row }}</span>
        <div class="seat-row__seats">
          <button
            v-for="seat in row.seats"
            :key="seat.id"
            type="button"
            class="seat"
            :class="[
              `seat--${seat.status}`,
              seat.status === 'available' ? 'seat-available' : '',
              isSelected(seat) ? 'seat--selected' : '',
            ]"
            data-testid="seat"
            :data-seat-id="seat.id"
            :data-section="seat.section"
            :data-status="seat.status"
            :data-price-cents="seat.price_cents"
            :data-selected="isSelected(seat) ? 'true' : 'false'"
            :aria-pressed="isSelected(seat)"
            :aria-label="`Seat ${label(seat)}, ${seat.status}, ${formatCents(seat.price_cents)}`"
            :title="`${label(seat)} · ${seat.status} · ${formatCents(seat.price_cents)}`"
            :disabled="isDisabled(seat)"
            @click="$emit('toggle', seat.id)"
          >
            <!--
              The `seat-available` marker from contract/testids.md. It is the
              seat's own label, so a click on it is a click on the seat.
            -->
            <span
              v-if="seat.status === 'available'"
              class="seat__label seat-available"
              data-testid="seat-available"
              :data-seat-id="seat.id"
              >{{ label(seat) }}</span
            >
            <span v-else class="seat__label">{{ label(seat) }}</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
