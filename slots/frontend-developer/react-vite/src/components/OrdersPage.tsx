import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Order } from "../lib/contract";
import { useAuthedSession } from "../state/session";
import { ErrorBanner, toDisplayError, type DisplayError } from "./ErrorBanner";
import { MoneyBreakdown } from "./MoneyBreakdown";

/**
 * The contract has no "list my orders" endpoint, so the browser remembers the
 * ids it created and re-reads each one with GET /orders/{id}.
 */
export function OrdersPage(): JSX.Element {
  const { token, orderIds } = useAuthedSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const results = await Promise.all(
          orderIds.map(async (id) => {
            try {
              return await api.getOrder(token, id);
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) setOrders(results.filter((o): o is Order => Boolean(o)));
      } catch (err) {
        if (!cancelled) setError(toDisplayError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, orderIds]);

  return (
    <main className="page">
      <div className="page__header">
        <h1 className="page__title">Orders</h1>
        <p className="page__meta">{orders.length} order{orders.length === 1 ? "" : "s"} in this browser</p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <section className="order-list" data-testid="order-list">
        {loading ? <p className="empty">Loading orders…</p> : null}
        {!loading && orders.length === 0 ? (
          <p className="empty" data-testid="order-list-empty">
            No orders yet — hold some seats and check out.
          </p>
        ) : null}
        {orders.map((order) => (
          <article className="card order-card" key={order.id} data-testid="order-card" data-order-id={order.id}>
            <header className="order-card__header">
              <code>{order.id}</code>
              <span className={`badge badge--${order.status}`}>{order.status}</span>
            </header>
            <p className="order-card__meta">
              {order.event_id} · {order.seat_ids.length} seat{order.seat_ids.length === 1 ? "" : "s"} ·{" "}
              {new Date(order.created_at).toISOString()}
            </p>
            <MoneyBreakdown
              idPrefix={`order-${order.id}`}
              subtotalCents={order.subtotal_cents}
              discountCents={order.discount_cents}
              feeCents={order.fee_cents}
              totalCents={order.total_cents}
              currency={order.currency}
            />
          </article>
        ))}
      </section>
    </main>
  );
}
