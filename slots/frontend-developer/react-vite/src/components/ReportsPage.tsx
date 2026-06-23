import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { RevenueReport } from "../lib/contract";
import { formatMoney } from "../lib/money";
import { useAuthedSession } from "../state/session";
import { ErrorBanner, toDisplayError, type DisplayError } from "./ErrorBanner";

/**
 * Organizer / admin revenue report. A buyer has no nav link to this view, and if
 * they reach it by URL the API answers 403 INSUFFICIENT_PERMISSION, which is
 * surfaced in the error banner — the numbers are never rendered for them.
 */
export function ReportsPage(): JSX.Element {
  const { token, user, canSeeReports } = useAuthedSession();
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.revenueReport(token);
        if (!cancelled) setReport(res);
      } catch (err) {
        if (!cancelled) {
          setReport(null);
          setError(toDisplayError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="page">
      <div className="page__header">
        <h1 className="page__title">Revenue</h1>
        <p className="page__meta">
          {user.email} · {user.role}
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {!canSeeReports && !error ? (
        <p className="empty" data-testid="revenue-forbidden">
          Revenue reporting is available to organizers and admins only.
        </p>
      ) : null}

      {loading ? <p className="empty">Loading revenue…</p> : null}

      {report ? (
        <section className="card revenue" data-testid="revenue-report" data-currency={report.currency}>
          <div className="revenue__totals">
            <div className="stat">
              <span className="stat__label">Gross</span>
              <span className="stat__value" data-testid="revenue-gross" data-cents={report.gross_cents}>
                {formatMoney(report.gross_cents, report.currency)}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Fees</span>
              <span className="stat__value" data-testid="revenue-fees" data-cents={report.fees_cents}>
                {formatMoney(report.fees_cents, report.currency)}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Discounts</span>
              <span className="stat__value" data-testid="revenue-discounts" data-cents={report.discounts_cents}>
                {formatMoney(report.discounts_cents, report.currency)}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Net</span>
              <span className="stat__value" data-testid="revenue-net" data-cents={report.net_cents}>
                {formatMoney(report.net_cents, report.currency)}
              </span>
            </div>
          </div>

          <table className="revenue__table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Orders</th>
                <th>Gross</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {report.by_event.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    No orders in range yet.
                  </td>
                </tr>
              ) : (
                report.by_event.map((row) => (
                  <tr key={row.event_id} data-testid="revenue-row" data-event-id={row.event_id}>
                    <td>{row.event_id}</td>
                    <td>{row.order_count}</td>
                    <td data-cents={row.gross_cents}>{formatMoney(row.gross_cents, report.currency)}</td>
                    <td data-cents={row.net_cents}>{formatMoney(row.net_cents, report.currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
