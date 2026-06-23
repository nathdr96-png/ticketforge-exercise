import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { AppButton } from "../components/AppButton";
import { ErrorBanner } from "../components/ErrorBanner";
import { HoldCountdown } from "../components/HoldCountdown";
import { MoneyBreakdown } from "../components/MoneyBreakdown";
import { SeatMap } from "../components/SeatMap";
import { SelectField } from "../components/SelectField";
import { api } from "../lib/api";
import {
  MAX_SEATS_PER_HOLD,
  SEAT_STATUSES,
  SECTIONS,
  type Hold,
  type Order,
  type Seat,
  type SeatStatus,
  type Section,
  type TfEvent,
} from "../lib/contract";
import { normaliseCode, previewPercentOff } from "../lib/discounts";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { mintIdempotencyKey } from "../lib/idempotency";
import { formatMoney, previewBreakdown, sumCents } from "../lib/money";
import { navigate } from "../lib/navigation";
import { useSignedInSession } from "../state/session";
import { colors, radius, space, type } from "../theme";

/** Below this width the checkout panel sits under the map instead of beside it. */
const TWO_PANE_WIDTH = 900;

interface OrderKey {
  holdId: string;
  discountCode: string | null;
  key: string;
}

/**
 * One event: the seat map, the selection, the hold and the checkout.
 *
 * This is the screen the whole product turns on, so the ordering of its effects
 * matters more than its looks:
 *
 *   * the full seat map is loaded once and filtered in memory, so changing a
 *     filter costs no round trip — on a phone that is the difference between a
 *     filter that feels instant and one that feels broken;
 *   * every mutation that can be refused reloads the map on BOTH paths. A
 *     refused hold means somebody else owns that seat now, and a buyer who is
 *     shown the error but not the new status taps the same seat again;
 *   * the hold is never discarded client-side because a request failed. A
 *     failed charge that also loses the seat is two bad outcomes instead of one.
 */
export function EventScreen({ eventId }: { eventId: string }) {
  const { token, rememberOrder } = useSignedInSession();
  const { width } = useWindowDimensions();
  const twoPane = width >= TWO_PANE_WIDTH;

  const [event, setEvent] = useState<TfEvent | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  const [section, setSection] = useState<"" | Section>("");
  const [availability, setAvailability] = useState<"" | SeatStatus>("");

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [hold, setHold] = useState<Hold | null>(null);
  const [holdExpired, setHoldExpired] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState<null | "hold" | "release" | "checkout">(null);

  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const orderKey = useRef<OrderKey | null>(null);

  const refreshSeats = useCallback(
    async (signal?: AbortSignal) => {
      const loaded = await api.listAllSeats(token, eventId, {}, signal);
      setSeats(loaded);
    },
    [token, eventId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setLoading(true);
    setError(null);
    setEvent(null);
    setSeats(null);
    setSelected(new Set<string>());
    setHold(null);
    setHoldExpired(false);
    setOrder(null);
    setSection("");
    setAvailability("");
    setCodeInput("");
    setAppliedCode(null);
    orderKey.current = null;

    void (async () => {
      try {
        const [loadedEvent] = await Promise.all([
          api.getEvent(token, eventId),
          refreshSeats(controller.signal),
        ]);
        if (live) setEvent(loadedEvent);
      } catch (cause) {
        if (live && !controller.signal.aborted) setError(toDisplayError(cause));
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [token, eventId, refreshSeats]);

  /** Reload without disturbing the error the user is already looking at. */
  const refreshSeatsQuietly = useCallback(async () => {
    try {
      await refreshSeats();
    } catch {
      /* the visible error from the action that failed is the more useful one */
    }
  }, [refreshSeats]);

  const seatsById = useMemo(() => {
    const index = new Map<string, Seat>();
    for (const seat of seats ?? []) index.set(seat.id, seat);
    return index;
  }, [seats]);

  /**
   * Both filters must hold at once: a section filter narrows to that section
   * AND an availability filter narrows to that status. Either one left blank
   * means "no constraint from this control", not "no constraint at all".
   */
  const visibleSeats = useMemo(() => {
    const all = seats ?? [];
    if (section === "" && availability === "") return all;
    return all.filter(
      (seat) =>
        (section === "" || seat.section === section) &&
        (availability === "" || seat.status === availability),
    );
  }, [seats, section, availability]);

  const tally = useMemo(() => {
    let available = 0;
    let held = 0;
    let sold = 0;
    for (const seat of seats ?? []) {
      if (seat.status === "available") available += 1;
      else if (seat.status === "held") held += 1;
      else sold += 1;
    }
    return { available, held, sold };
  }, [seats]);

  const selectedSeats = useMemo(
    () =>
      [...selected]
        .map((id) => seatsById.get(id))
        .filter((seat): seat is Seat => seat !== undefined),
    [selected, seatsById],
  );

  const subtotalCents = useMemo(
    () => sumCents(selectedSeats.map((seat) => seat.price_cents)),
    [selectedSeats],
  );

  const quotedPercentOff = appliedCode === null ? null : previewPercentOff(appliedCode, eventId);
  const quote = useMemo(
    () => previewBreakdown(subtotalCents, quotedPercentOff ?? 0),
    [subtotalCents, quotedPercentOff],
  );

  const toggleSeat = useCallback((seatId: string) => {
    setError(null);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(seatId)) next.delete(seatId);
      else if (next.size < MAX_SEATS_PER_HOLD) next.add(seatId);
      return next;
    });
  }, []);

  /**
   * One key per (hold, discount code) pair, so a retry of the same purchase
   * sends the same key and the API replays the original order rather than
   * charging twice. A changed code is a different request body, so it gets a
   * fresh key instead of provoking `IDEMPOTENCY_KEY_CONFLICT`.
   */
  const idempotencyKey = useMemo(() => {
    if (!hold) {
      orderKey.current = null;
      return "";
    }
    const current = orderKey.current;
    if (current && current.holdId === hold.id && current.discountCode === appliedCode) {
      return current.key;
    }
    const minted = mintIdempotencyKey(hold.id);
    orderKey.current = { holdId: hold.id, discountCode: appliedCode, key: minted };
    return minted;
  }, [hold, appliedCode]);

  async function placeHold(): Promise<void> {
    if (selected.size === 0 || busy !== null) return;
    setBusy("hold");
    setError(null);
    try {
      const created = await api.createHold(token, eventId, [...selected]);
      setHold(created);
      setHoldExpired(false);
      setOrder(null);
      orderKey.current = null;
      await refreshSeatsQuietly();
    } catch (cause) {
      setError(toDisplayError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function releaseHold(): Promise<void> {
    if (!hold || busy !== null) return;
    setBusy("release");
    setError(null);
    try {
      await api.releaseHold(token, hold.id);
      setHold(null);
      setHoldExpired(false);
      setSelected(new Set<string>());
      orderKey.current = null;
      await refreshSeatsQuietly();
    } catch (cause) {
      setError(toDisplayError(cause));
      await refreshSeatsQuietly();
    } finally {
      setBusy(null);
    }
  }

  async function checkout(): Promise<void> {
    if (!hold || busy !== null) return;
    setBusy("checkout");
    setError(null);
    try {
      const created = await api.createOrder(token, idempotencyKey, hold.id, appliedCode);
      setOrder(created);
      rememberOrder(created.id);
      setHold(null);
      setSelected(new Set<string>());
      await refreshSeatsQuietly();
    } catch (cause) {
      // The hold is deliberately NOT cleared. A rejected discount code or a
      // transient failure must leave the buyer able to try again on the seats
      // they still own, with the same idempotency key.
      setError(toDisplayError(cause));
      await refreshSeatsQuietly();
    } finally {
      setBusy(null);
    }
  }

  function applyDiscount(): void {
    const code = normaliseCode(codeInput);
    setError(null);
    setAppliedCode(code.length > 0 ? code : null);
  }

  function clearDiscount(): void {
    setCodeInput("");
    setAppliedCode(null);
    setError(null);
  }

  const currency = event?.currency ?? "USD";

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable role="button" onPress={() => navigate({ name: "events" })} hitSlop={8}>
          <Text style={styles.back}>{"←"} All events</Text>
        </Pressable>
        <Text testID="event-title" dataSet={{ eventId }} role="heading" style={styles.title}>
          {event?.title ?? (loading ? "Loading event…" : eventId)}
        </Text>
        {event ? (
          <Text style={styles.meta}>
            {event.venue} {"·"} {event.seat_count} seats {"·"} {event.currency}
          </Text>
        ) : null}
      </View>

      <View style={styles.bannerSlot}>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      </View>

      <View style={[styles.panes, twoPane ? styles.panesWide : styles.panesNarrow]}>
        <View style={[styles.mapPane, twoPane ? null : styles.mapPaneNarrow]}>
          <View style={styles.toolbar}>
            <SelectField
              label="Section"
              testID="filter-section"
              value={section}
              options={[
                { value: "", label: "All sections" },
                ...SECTIONS.map((letter) => ({ value: letter, label: `Section ${letter}` })),
              ]}
              onChange={(next) => setSection(next as "" | Section)}
            />
            <SelectField
              label="Availability"
              testID="filter-availability"
              value={availability}
              options={[
                { value: "", label: "Any status" },
                ...SEAT_STATUSES.map((status) => ({ value: status, label: status })),
              ]}
              onChange={(next) => setAvailability(next as "" | SeatStatus)}
            />
            <View style={styles.counts}>
              <Text style={styles.countsLine}>
                <Text testID="seat-count-visible" style={styles.countsStrong}>
                  {visibleSeats.length}
                </Text>
                <Text style={styles.countsMuted}> shown</Text>
              </Text>
              <Text style={styles.countsMuted}>
                {tally.available} available {"·"} {tally.held} held {"·"} {tally.sold} sold
              </Text>
            </View>
          </View>

          {seats === null ? (
            <View style={styles.loadingMap}>
              <ActivityIndicator accessibilityLabel="Loading seat map" />
              <Text testID="seat-map-loading" style={styles.countsMuted}>
                Loading seat map{"…"}
              </Text>
            </View>
          ) : (
            <SeatMap
              seats={visibleSeats}
              selected={selected}
              selectionFull={selected.size >= MAX_SEATS_PER_HOLD}
              locked={hold !== null || order !== null}
              onToggle={toggleSeat}
            />
          )}
        </View>

        <ScrollView
          style={[styles.checkoutPane, twoPane ? styles.checkoutPaneWide : styles.checkoutPaneNarrow]}
          contentContainerStyle={styles.checkoutContent}
          keyboardShouldPersistTaps="handled"
        >
          {order ? (
            <View
              testID="order-confirmation"
              dataSet={{ orderId: order.id }}
              style={styles.confirmation}
            >
              <Text style={styles.confirmationHeadline}>Order confirmed</Text>
              <Text style={styles.countsMuted}>
                {order.id} {"·"} {order.status}
              </Text>
              <Text style={styles.countsMuted}>
                {order.seat_ids.length} seat{order.seat_ids.length === 1 ? "" : "s"}:{" "}
                {order.seat_ids.join(", ")}
              </Text>
              <MoneyBreakdown
                idPrefix="order"
                subtotalCents={order.subtotal_cents}
                discountCents={order.discount_cents}
                feeCents={order.fee_cents}
                totalCents={order.total_cents}
                currency={order.currency}
                totalTestID="order-total"
                note={
                  order.discount_code ? `Discount code ${order.discount_code} applied.` : undefined
                }
              />
              <View style={styles.actions}>
                <AppButton
                  testID="order-new"
                  label="Buy more seats"
                  onPress={() => {
                    setOrder(null);
                    setAppliedCode(null);
                    setCodeInput("");
                    orderKey.current = null;
                  }}
                />
                <AppButton
                  label="View orders"
                  variant="ghost"
                  onPress={() => navigate({ name: "orders" })}
                />
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.paneTitle}>Your seats</Text>

              <View testID="selection-list" style={styles.selection}>
                {selectedSeats.length === 0 ? (
                  <Text style={styles.countsMuted}>Tap an available seat on the map.</Text>
                ) : (
                  selectedSeats.map((seat) => (
                    <View key={seat.id} dataSet={{ seatId: seat.id }} style={styles.selectionRow}>
                      <Text style={styles.selectionLabel}>
                        {seat.section}
                        {seat.row}-{String(seat.number).padStart(2, "0")}
                      </Text>
                      <Text dataSet={{ cents: seat.price_cents }} style={styles.selectionLabel}>
                        {formatMoney(seat.price_cents, currency)}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <MoneyBreakdown
                idPrefix="checkout"
                subtotalCents={quote.subtotal_cents}
                discountCents={quote.discount_cents}
                feeCents={quote.fee_cents}
                totalCents={quote.total_cents}
                currency={currency}
                note={
                  appliedCode !== null && quotedPercentOff === null
                    ? `Code ${appliedCode} will be checked by the server at checkout.`
                    : "Fee = floor(subtotal after discount × 5%) + 30. The API confirms the final amounts."
                }
              />

              <View style={styles.discount}>
                <Text style={styles.label}>Discount code</Text>
                <View style={styles.discountRow}>
                  <TextInput
                    testID="discount-code"
                    accessibilityLabel="Discount code"
                    value={codeInput}
                    onChangeText={setCodeInput}
                    // A hint to the soft keyboard, nothing more: it does not
                    // change the value, and it does nothing at all to a pasted
                    // code. Normalising is still lib/discounts.ts's job.
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={applyDiscount}
                    placeholder="SAVE10"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                  <AppButton
                    testID="discount-apply"
                    label="Apply"
                    disabled={codeInput.trim().length === 0}
                    onPress={applyDiscount}
                  />
                </View>
                {appliedCode !== null ? (
                  <View style={styles.discountRow}>
                    <Text
                      testID="discount-applied"
                      dataSet={{ code: appliedCode }}
                      style={styles.countsMuted}
                    >
                      {appliedCode} applied
                      {quotedPercentOff !== null ? ` — ${quotedPercentOff}% off subtotal` : ""}
                    </Text>
                    <AppButton
                      testID="discount-clear"
                      label="Remove"
                      variant="ghost"
                      onPress={clearDiscount}
                    />
                  </View>
                ) : null}
              </View>

              {hold ? (
                <>
                  <HoldCountdown
                    expiresAt={hold.expires_at}
                    onExpired={() => setHoldExpired(true)}
                  />
                  <Text testID="hold-id" dataSet={{ holdId: hold.id }} style={styles.countsMuted}>
                    Hold {hold.id}
                  </Text>
                  <View style={styles.keyRow}>
                    <Text style={styles.label}>Idempotency-Key</Text>
                    <TextInput
                      testID="idempotency-key"
                      accessibilityLabel="Idempotency key"
                      value={idempotencyKey}
                      editable={false}
                      selectTextOnFocus
                      style={[styles.input, styles.inputReadOnly]}
                    />
                  </View>
                  <View style={styles.actions}>
                    <AppButton
                      testID="checkout-button"
                      label={busy === "checkout" ? "Placing order…" : "Checkout"}
                      variant="primary"
                      disabled={busy !== null || holdExpired}
                      onPress={() => void checkout()}
                    />
                    <AppButton
                      testID="release-button"
                      label={busy === "release" ? "Releasing…" : "Release hold"}
                      disabled={busy !== null}
                      onPress={() => void releaseHold()}
                    />
                  </View>
                </>
              ) : (
                <AppButton
                  testID="hold-button"
                  label={
                    busy === "hold"
                      ? "Holding…"
                      : selected.size === 0
                        ? "Hold seats"
                        : `Hold ${selected.size} seat${selected.size === 1 ? "" : "s"}`
                  }
                  variant="primary"
                  disabled={selected.size === 0 || busy !== null}
                  onPress={() => void placeHold()}
                />
              )}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, gap: 2 },
  back: { fontSize: type.caption, fontWeight: "600", color: colors.primary },
  title: { fontSize: type.title, fontWeight: "700", color: colors.text },
  meta: { fontSize: type.caption, color: colors.textMuted },
  bannerSlot: { paddingHorizontal: space.lg, paddingTop: space.md },
  panes: { flex: 1, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg },
  panesWide: { flexDirection: "row" },
  panesNarrow: { flexDirection: "column" },
  mapPane: {
    flex: 1,
    minHeight: 200,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  mapPaneNarrow: { flex: 2 },
  toolbar: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", gap: space.md },
  counts: { gap: 2 },
  countsLine: { flexDirection: "row" },
  countsStrong: { fontSize: type.body, fontWeight: "700", color: colors.text },
  countsMuted: { fontSize: type.caption, color: colors.textMuted },
  loadingMap: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  checkoutPane: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  checkoutPaneWide: { width: 360, flexGrow: 0, flexShrink: 0 },
  checkoutPaneNarrow: { flex: 1, minHeight: 220 },
  checkoutContent: { padding: space.lg, gap: space.md },
  paneTitle: { fontSize: type.heading, fontWeight: "700", color: colors.text },
  selection: { gap: space.xs },
  selectionRow: { flexDirection: "row", justifyContent: "space-between" },
  selectionLabel: { fontSize: type.body, color: colors.text },
  discount: { gap: space.sm },
  discountRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { fontSize: type.caption, fontWeight: "600", color: colors.textMuted },
  input: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: type.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputReadOnly: { color: colors.textMuted, fontSize: type.caption },
  keyRow: { gap: space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  confirmation: { gap: space.sm },
  confirmationHeadline: { fontSize: type.heading, fontWeight: "700", color: colors.available },
});
