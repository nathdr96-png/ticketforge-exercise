import { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";

import type { Seat, SeatStatus } from "../lib/contract";
import { formatCents } from "../lib/money";
import { SEAT_ROW_HEIGHT, colors, radius, seatSize, space, type } from "../theme";

/**
 * The seat map: up to 2,000 tappable seats, grouped into rows, in a `FlatList`.
 *
 * WHAT MAKES THIS LIST FAST, AND WHAT DOES NOT.
 *
 * The contract requires the whole map to be addressable at once — every seat
 * carries `data-seat-id`, and `seat-count-visible` is a count over all of them —
 * so windowing is off: `initialNumToRender` covers the list, `windowSize` is
 * effectively unbounded and `removeClippedSubviews` is false. A virtualised
 * list that renders ten rows would report a seat map with 200 seats in it, and
 * on a device it would mean a buyer who scrolls fast sees blank rows where the
 * cheap seats are.
 *
 * So the cost is paid down elsewhere, four ways:
 *
 *   1. THE LIST IS 100 ITEMS, NOT 2,000. Seats are grouped into (section, row)
 *      items of 20, which is also how a seat map is read. One cell per seat
 *      would mean 2,000 `CellRenderer` wrappers, each with its own layout and
 *      key bookkeeping, for no visual gain.
 *   2. `getItemLayout` RETURNS A CONSTANT. Row height is derived from
 *      `theme.seatSize`, so no row is ever measured: `FlatList` skips the
 *      onLayout pass entirely, which is the single biggest win on a long list
 *      and the one most often left on the table.
 *   3. EVERY LEAF IS MEMOISED ON PRIMITIVES. `SeatTile` takes strings, numbers
 *      and booleans — never the `Seat` object and never the selection `Set` —
 *      so selecting one seat re-renders one tile, not two thousand. `SeatRow`
 *      is memoised the same way, with its selection collapsed into one string.
 *   4. THE PRESS HANDLER IS STABLE. `onToggle` is a `useCallback` in the screen
 *      and is passed down unchanged, with the seat id handed back on press, so
 *      no tile ever re-renders because its callback was re-created.
 *
 * Measured ranges for the arena are in the README, with the caveat that matters:
 * they are web numbers from a loaded machine, and they say nothing certain about
 * the same list on a mid-range Android device.
 */

interface SeatRowData {
  key: string;
  section: string;
  row: string;
  seats: Seat[];
}

/** Group by (section, row), ordering as a venue map reads. */
function groupIntoRows(seats: readonly Seat[]): SeatRowData[] {
  const byKey = new Map<string, SeatRowData>();
  for (const seat of seats) {
    const key = `${seat.section}${seat.row}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, section: seat.section, row: seat.row, seats: [] };
      byKey.set(key, row);
    }
    row.seats.push(seat);
  }
  const rows = [...byKey.values()];
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const row of rows) row.seats.sort((a, b) => a.number - b.number);
  return rows;
}

const STATUS_STYLE: Record<SeatStatus, { tile: ViewStyle; label: TextStyle }> = {
  available: {
    tile: { backgroundColor: colors.availableSurface, borderColor: colors.available },
    label: { color: colors.available },
  },
  held: {
    tile: { backgroundColor: colors.heldSurface, borderColor: colors.held },
    label: { color: colors.held },
  },
  sold: {
    tile: { backgroundColor: colors.soldSurface, borderColor: colors.sold },
    label: { color: colors.sold },
  },
};

/**
 * One seat.
 *
 * contract/testids.md: `seat` with `data-seat-id`, `data-section` and
 * `data-status`, plus the `seat-available` marker when the seat is free. The
 * marker is the tile's own label, so a tap on it is a tap on the seat.
 */
const SeatTile = memo(function SeatTile({
  id,
  label,
  section,
  status,
  priceCents,
  selected,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  section: string;
  status: SeatStatus;
  priceCents: number;
  selected: boolean;
  disabled: boolean;
  onToggle(seatId: string): void;
}) {
  const available = status === "available";
  const palette = STATUS_STYLE[status];
  return (
    <Pressable
      testID="seat"
      dataSet={{
        seatId: id,
        section,
        status,
        priceCents,
        selected: selected ? "true" : "false",
      }}
      role="button"
      accessibilityLabel={`Seat ${label}, ${status}, ${formatCents(priceCents)}`}
      accessibilityState={{ disabled: disabled && !selected, selected }}
      disabled={disabled && !selected}
      onPress={() => onToggle(id)}
      style={[
        styles.seat,
        palette.tile,
        selected ? styles.seatSelected : null,
        disabled && !selected ? styles.seatDisabled : null,
      ]}
    >
      <Text
        testID={available ? "seat-available" : undefined}
        dataSet={available ? { seatId: id } : undefined}
        numberOfLines={1}
        style={[styles.seatLabel, palette.label, selected ? styles.seatLabelSelected : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const SeatRow = memo(function SeatRow({
  row,
  selectedKey,
  locked,
  selectionFull,
  onToggle,
}: {
  row: SeatRowData;
  /** The row's selected seat ids, collapsed so `memo` can compare them. */
  selectedKey: string;
  locked: boolean;
  selectionFull: boolean;
  onToggle(seatId: string): void;
}) {
  const selected = selectedKey.length > 0 ? new Set(selectedKey.split(",")) : null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {row.section}
        {row.row}
      </Text>
      <View style={styles.rowSeats}>
        {row.seats.map((seat) => {
          const isSelected = selected?.has(seat.id) ?? false;
          return (
            <SeatTile
              key={seat.id}
              id={seat.id}
              label={`${seat.section}${seat.row}-${String(seat.number).padStart(2, "0")}`}
              section={seat.section}
              status={seat.status}
              priceCents={seat.price_cents}
              selected={isSelected}
              disabled={locked || seat.status !== "available" || selectionFull}
              onToggle={onToggle}
            />
          );
        })}
      </View>
    </View>
  );
});

export function SeatMap({
  seats,
  selected,
  selectionFull,
  locked,
  onToggle,
}: {
  /** Already filtered by the screen — this component renders what it is given. */
  seats: readonly Seat[];
  selected: ReadonlySet<string>;
  /** `MAX_SEATS_PER_HOLD` already reached: further free seats stop responding. */
  selectionFull: boolean;
  /** A hold or an order exists, so the map is read-only until it is released. */
  locked: boolean;
  onToggle(seatId: string): void;
}) {
  const rows = useMemo(() => groupIntoRows(seats), [seats]);

  const getItemLayout = useCallback(
    (_data: readonly SeatRowData[] | null | undefined, index: number) => ({
      length: SEAT_ROW_HEIGHT,
      offset: SEAT_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: SeatRowData }) => {
      const mine: string[] = [];
      for (const seat of item.seats) if (selected.has(seat.id)) mine.push(seat.id);
      return (
        <SeatRow
          row={item}
          selectedKey={mine.join(",")}
          locked={locked}
          selectionFull={selectionFull}
          onToggle={onToggle}
        />
      );
    },
    [selected, locked, selectionFull, onToggle],
  );

  return (
    <View testID="seat-map" dataSet={{ seatCount: seats.length }} style={styles.map}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        extraData={selected}
        // Deliberately unwindowed — see the note at the top of this file.
        initialNumToRender={Math.max(1, rows.length)}
        maxToRenderPerBatch={Math.max(1, rows.length)}
        windowSize={Number.MAX_SAFE_INTEGER}
        removeClippedSubviews={false}
        ListEmptyComponent={
          <Text testID="seat-map-empty" style={styles.empty}>
            No seats match these filters.
          </Text>
        }
        contentContainerStyle={styles.mapContent}
        showsVerticalScrollIndicator
      />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 160 },
  mapContent: { paddingVertical: space.sm, paddingHorizontal: space.xs },
  row: { height: SEAT_ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: space.sm },
  rowLabel: {
    width: 30,
    fontSize: type.micro,
    fontWeight: "700",
    color: colors.textMuted,
  },
  rowSeats: { flex: 1, flexDirection: "row", flexWrap: "nowrap", gap: seatSize.gap },
  seat: {
    width: seatSize.width,
    height: seatSize.height,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  seatSelected: { backgroundColor: colors.selectedSurface, borderColor: colors.selected, borderWidth: 2 },
  seatDisabled: { opacity: 0.6 },
  seatLabel: { fontSize: type.micro, fontWeight: "600" },
  seatLabelSelected: { color: colors.selected },
  empty: { padding: space.lg, fontSize: type.body, color: colors.textMuted },
});
