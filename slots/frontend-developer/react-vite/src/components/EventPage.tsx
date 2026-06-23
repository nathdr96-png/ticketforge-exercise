import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Hold, Order, Seat, SeatSection, SeatStatus, TfEvent } from "../lib/contract";
import { SECTIONS, SEAT_STATUSES } from "../lib/contract";
import { normaliseCode, previewPercentOff } from "../lib/discounts";
import { newIdempotencyKey } from "../lib/idempotency";
import { formatMoney, previewBreakdown, sumCents } from "../lib/money";
import { hrefFor, navigate } from "../lib/router";
import { useAuthedSession } from "../state/session";
import { ErrorBanner, toDisplayError, type DisplayError } from "./ErrorBanner";
import { HoldCountdown } from "./HoldCountdown";
import { MoneyBreakdown } from "./MoneyBreakdown";
import { SeatMap } from "./SeatMap";

/** contract/openapi.yaml CreateHoldRequest.seat_ids maxItems. */
const MAX_SEATS_PER_HOLD = 10;

interface OrderKey {
  holdId: string;
  discountCode: string | null;
  key: string;
}

export function EventPage({ eventId }: { eventId: string }): JSX.Element {
  const { token, rememberOrder } = useAuthedSession();

  const [event, setEvent] = useState<TfEvent | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  const [section, setSection] = useState<"" | SeatSection>("");
  const [availability, setAvailability] = useState<"" | SeatStatus>("");

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [hold, setHold] = useState<Hold | null>(null);
  const [holdExpired, setHoldExpired] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState<null | "hold" | "release" | "checkout">(null);

  const [discountInput, setDiscountInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const orderKeyRef = useRef<OrderKey | null>(null);

  const loadSeats = useCallback(
    async (signal?: AbortSignal) => {
      const all = await api.listAllSeats(token, eventId, {}, signal);
      setSeats(all);
      return all;
    },
    [token, eventId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSeats(null);
    setEvent(null);
    setSelected(new Set<string>());
    setHold(null);
    setOrder(null);
    setHoldExpired(false);
    setAppliedCode(null);
    setDiscountInput("");
    orderKeyRef.current = null;

    (async () => {
      try {
        const [ev] = await Promise.all([api.getEvent(token, eventId), loadSeats(controller.signal)]);
        if (!cancelled) setEvent(ev);
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) setError(toDisplayError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token, eventId, loadSeats]);

  const seatIndex = useMemo(() => {
    const map = new Map<string, Seat>();
    for (const seat of seats ?? []) map.set(seat.id, seat);
    return map;
  }, [seats]);

  /** Filtering happens in memory over the fully loaded map so it is instant. */
  const visibleSeats = useMemo(() => {
    const all = seats ?? [];
    if (!section && !availability) return all;
    return all.filter(
      (seat) =>
        (!section || seat.section === section) && (!availability || seat.status === availability),
    );
  }, [seats, section, availability]);

  const counts = useMemo(() => {
    let available = 0;
    let held = 0;
    let sold = 0;
    for (const seat of seats ?? []) {
      if (seat.status === "available") available++;
      else if (seat.status === "held") held++;
      else sold++;
    }
    return { available, held, sold, total: (seats ?? []).length };
  }, [seats]);

  const selectedSeats = useMemo(
    () => [...selected].map((id) => seatIndex.get(id)).filter((s): s is Seat => Boolean(s)),
    [selected, seatIndex],
  );

  const subtotalCents = useMemo(
    () => sumCents(selectedSeats.map((s) => s.price_cents)),
    [selectedSeats],
  );

  const previewPercent = appliedCode ? previewPercentOff(appliedCode, eventId) : null;
  const preview = useMemo(
    () => previewBreakdown(subtotalCents, previewPercent ?? 0),
    [subtotalCents, previewPercent],
  );

  const toggleSeat = useCallback(
    (seatId: string) => {
      setError(null);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(seatId)) next.delete(seatId);
        else if (next.size < MAX_SEATS_PER_HOLD) next.add(seatId);
        return next;
      });
    },
    [],
  );

  async function refreshSeatsQuietly(): Promise<void> {
    try {
      await loadSeats();
    } catch {
      /* the visible error from the failed action is the more useful one */
    }
  }

  async function placeHold(): Promise<void> {
    if (selected.size === 0 || busy) return;
    setBusy("hold");
    setError(null);
    try {
      const created = await api.createHold(token, { event_id: eventId, seat_ids: [...selected] });
      setHold(created);
      setHoldExpired(false);
      setOrder(null);
      orderKeyRef.current = null;
      await refreshSeatsQuietly();
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function releaseHold(): Promise<void> {
    if (!hold || busy) return;
    setBusy("release");
    setError(null);
    try {
      await api.releaseHold(token, hold.id);
      setHold(null);
      setHoldExpired(false);
      setSelected(new Set<string>());
      orderKeyRef.current = null;
      await refreshSeatsQuietly();
    } catch (err) {
      setError(toDisplayError(err));
      await refreshSeatsQuietly();
    } finally {
      setBusy(null);
    }
  }

  /**
   * One key per (hold, discount code) pair: retrying the same checkout replays
   * the original order (T3-02) while changing the discount code is a different
   * request body and therefore gets its own key instead of a 409 conflict.
   */
  const idempotencyKey = useMemo(() => {
    if (!hold) {
      orderKeyRef.current = null;
      return "";
    }
    const current = orderKeyRef.current;
    if (current && current.holdId === hold.id && current.discountCode === appliedCode) {
      return current.key;
    }
    const key = newIdempotencyKey(hold.id);
    orderKeyRef.current = { holdId: hold.id, discountCode: appliedCode, key };
    return key;
  }, [hold, appliedCode]);

  async function checkout(): Promise<void> {
    if (!hold || busy) return;
    setBusy("checkout");
    setError(null);
    const code = appliedCode;
    const key = idempotencyKey;
    try {
      const created = await api.createOrder(
        token,
        key,
        code ? { hold_id: hold.id, discount_code: code } : { hold_id: hold.id },
      );
      setOrder(created);
      rememberOrder(created.id);
      setHold(null);
      setSelected(new Set<string>());
      await refreshSeatsQuietly();
    } catch (err) {
      setError(toDisplayError(err));
      await refreshSeatsQuietly();
    } finally {
      setBusy(null);
    }
  }

  function applyDiscount(): void {
    const code = normaliseCode(discountInput);
    setError(null);
    setAppliedCode(code || null);
  }

  function clearDiscount(): void {
    setDiscountInput("");
    setAppliedCode(null);
    setError(null);
  }

  const currency = event?.currency ?? "USD";

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <a className="backlink" href={hrefFor({ name: "events" })}>
            ← All events
          </a>
          <h1 className="page__title" data-testid="event-title" data-event-id={eventId}>
            {event?.title ?? (loading ? "Loading event…" : eventId)}
          </h1>
          {event ? (
            <p className="page__meta">
              {event.venue} · {new Date(event.starts_at).toISOString().replace("T", " ").replace(".000Z", " UTC")} ·{" "}
              {event.seat_count} seats · {event.currency}
            </p>
          ) : null}
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="event-layout">
        <section className="card seat-panel">
          <div className="seat-panel__toolbar">
            <label className="field field--inline">
              <span className="field__label">Section</span>
              <select
                className="field__input"
                data-testid="filter-section"
                value={section}
                onChange={(e) => setSection(e.target.value as "" | SeatSection)}
              >
                <option value="">All sections</option>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    Section {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span className="field__label">Availability</span>
              <select
                className="field__input"
                data-testid="filter-availability"
                value={availability}
                onChange={(e) => setAvailability(e.target.value as "" | SeatStatus)}
              >
                <option value="">Any status</option>
                {SEAT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <span className="seat-panel__counts" data-testid="seat-counts">
              <span data-testid="seat-count-visible">{visibleSeats.length}</span> shown ·{" "}
              {counts.available} available · {counts.held} held · {counts.sold} sold
            </span>
          </div>

          <div className="legend" aria-hidden="true">
            <span className="legend__item">
              <span className="seat seat--available legend__swatch" /> available
            </span>
            <span className="legend__item">
              <span className="seat seat--held legend__swatch" /> held
            </span>
            <span className="legend__item">
              <span className="seat seat--sold legend__swatch" /> sold
            </span>
            <span className="legend__item">
              <span className="seat seat--selected legend__swatch" /> selected
            </span>
          </div>

          {seats === null ? (
            <p className="empty" data-testid="seat-map-loading">
              Loading seat map…
            </p>
          ) : (
            <SeatMap
              seats={visibleSeats}
              selected={selected}
              selectionFull={selected.size >= MAX_SEATS_PER_HOLD}
              locked={Boolean(hold) || Boolean(order)}
              onToggle={toggleSeat}
            />
          )}
        </section>

        <aside className="card checkout">
          <h2 className="checkout__title">Your seats</h2>

          {order ? (
            /* ---------- order confirmation ---------- */
            <div className="confirmation" data-testid="order-confirmation" data-order-id={order.id}>
              <p className="confirmation__headline">Order confirmed</p>
              <p className="confirmation__id">
                Order <code>{order.id}</code> · {order.status}
              </p>
              <p className="confirmation__seats">
                {order.seat_ids.length} seat{order.seat_ids.length === 1 ? "" : "s"}:{" "}
                {order.seat_ids.join(", ")}
              </p>
              <MoneyBreakdown
                idPrefix="order"
                subtotalCents={order.subtotal_cents}
                discountCents={order.discount_cents}
                feeCents={order.fee_cents}
                totalCents={order.total_cents}
                currency={order.currency}
                totalTestId="order-total"
                note={
                  order.discount_code
                    ? `Discount code ${order.discount_code} applied.`
                    : undefined
                }
              />
              <div className="checkout__actions">
                <button
                  className="button"
                  type="button"
                  data-testid="order-new"
                  onClick={() => {
                    setOrder(null);
                    setAppliedCode(null);
                    setDiscountInput("");
                    orderKeyRef.current = null;
                  }}
                >
                  Buy more seats
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => navigate({ name: "orders" })}
                >
                  View orders
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul className="selection" data-testid="selection-list">
                {selectedSeats.length === 0 ? (
                  <li className="empty">Pick an available seat on the map.</li>
                ) : (
                  selectedSeats.map((seat) => (
                    <li key={seat.id} className="selection__item" data-seat-id={seat.id}>
                      <span>
                        {seat.section}
                        {seat.row}-{String(seat.number).padStart(2, "0")}
                      </span>
                      <span data-cents={seat.price_cents}>{formatMoney(seat.price_cents, currency)}</span>
                    </li>
                  ))
                )}
              </ul>

              <MoneyBreakdown
                idPrefix="checkout"
                subtotalCents={preview.subtotal_cents}
                discountCents={preview.discount_cents}
                feeCents={preview.fee_cents}
                totalCents={preview.total_cents}
                currency={currency}
                note={
                  appliedCode && previewPercent === null
                    ? `Code ${appliedCode} will be validated by the server at checkout.`
                    : "Fee = floor(subtotal after discount × 5%) + 30. Final amounts are confirmed by the API."
                }
              />

              <div className="discount">
                <label className="field field--inline">
                  <span className="field__label">Discount code</span>
                  <input
                    className="field__input"
                    data-testid="discount-code"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    placeholder="SAVE10"
                  />
                </label>
                <button
                  className="button"
                  type="button"
                  data-testid="discount-apply"
                  disabled={!discountInput.trim()}
                  onClick={applyDiscount}
                >
                  Apply
                </button>
                {appliedCode ? (
                  <button
                    className="button button--ghost"
                    type="button"
                    data-testid="discount-clear"
                    onClick={clearDiscount}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {appliedCode ? (
                <p className="discount__applied" data-testid="discount-applied" data-code={appliedCode}>
                  {appliedCode} applied
                  {previewPercent !== null ? ` — ${previewPercent}% off subtotal` : ""}
                </p>
              ) : null}

              {hold ? (
                <>
                  <HoldCountdown expiresAt={hold.expires_at} onExpired={() => setHoldExpired(true)} />
                  <p className="hold__meta" data-testid="hold-id" data-hold-id={hold.id}>
                    Hold <code>{hold.id}</code> · {hold.seat_ids.length} seat
                    {hold.seat_ids.length === 1 ? "" : "s"}
                  </p>
                  <input type="hidden" data-testid="idempotency-key" value={idempotencyKey} readOnly />
                  <div className="checkout__actions">
                    <button
                      className="button button--primary"
                      type="button"
                      data-testid="checkout-button"
                      disabled={busy !== null || holdExpired}
                      onClick={() => void checkout()}
                    >
                      {busy === "checkout" ? "Placing order…" : "Checkout"}
                    </button>
                    <button
                      className="button"
                      type="button"
                      data-testid="release-button"
                      disabled={busy !== null}
                      onClick={() => void releaseHold()}
                    >
                      {busy === "release" ? "Releasing…" : "Release hold"}
                    </button>
                  </div>
                  <p className="checkout__key">
                    Idempotency-Key: <code>{idempotencyKey}</code>
                  </p>
                </>
              ) : (
                <button
                  className="button button--primary"
                  type="button"
                  data-testid="hold-button"
                  disabled={selected.size === 0 || busy !== null}
                  onClick={() => void placeHold()}
                >
                  {busy === "hold"
                    ? "Holding…"
                    : `Hold ${selected.size || ""} seat${selected.size === 1 ? "" : "s"}`.trim()}
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
