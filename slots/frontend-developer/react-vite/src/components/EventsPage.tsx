import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { EventList } from "../lib/contract";
import { formatMoney } from "../lib/money";
import { navigate } from "../lib/router";
import { useAuthedSession } from "../state/session";
import { ErrorBanner, toDisplayError, type DisplayError } from "./ErrorBanner";

const PAGE_SIZE = 10;

/**
 * Selectable page sizes. The small ones are not decoration: a catalogue with a
 * handful of published events must still be navigable page by page, and the
 * conformance suite drives pagination through this control rather than assuming
 * how many events the deployment happens to have.
 */
const PAGE_SIZES = [2, 5, 10, 25] as const;

function formatStartsAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function EventsPage(): JSX.Element {
  const { token } = useAuthedSession();
  const [page, setPage] = useState(1);
  const [requestedPageSize, setRequestedPageSize] = useState<number>(PAGE_SIZE);
  const [result, setResult] = useState<EventList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  const load = useCallback(
    async (nextPage: number, nextPageSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.listEvents(token, { page: nextPage, page_size: nextPageSize });
        setResult(res);
      } catch (err) {
        setError(toDisplayError(err));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(page, requestedPageSize);
  }, [load, page, requestedPageSize]);

  const total = result?.total ?? 0;
  const pageSize = result?.page_size ?? requestedPageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="page">
      <div className="page__header">
        <h1 className="page__title">Events</h1>
        <p className="page__meta" data-testid="event-total" data-total={total}>
          {total} event{total === 1 ? "" : "s"}
        </p>
        <label className="field field--inline">
          <span className="field__label">Per page</span>
          <select
            className="field__input"
            data-testid="events-page-size"
            value={requestedPageSize}
            onChange={(e) => {
              // Changing the page size must return to page 1: staying on page 4
              // of a list that now has two pages would show an empty list.
              setPage(1);
              setRequestedPageSize(Number(e.target.value));
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* The container always renders so the list is addressable while loading. */}
      <section className="event-list" data-testid="event-list" aria-busy={loading}>
        {result?.data.map((event) => (
          <article
            key={event.id}
            className="card event-card"
            data-testid="event-card"
            data-event-id={event.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate({ name: "event", eventId: event.id })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate({ name: "event", eventId: event.id });
              }
            }}
          >
            <div className="event-card__main">
              <h2 className="event-card__title">{event.title}</h2>
              <p className="event-card__venue">
                {event.venue} · {formatStartsAt(event.starts_at)}
              </p>
              {event.description ? <p className="event-card__desc">{event.description}</p> : null}
            </div>
            <div className="event-card__side">
              <span className={`badge badge--${event.status}`}>{event.status}</span>
              <span className="event-card__price">
                from {formatMoney(event.base_price_cents, event.currency)}
              </span>
              <span className="event-card__seats">{event.seat_count} seats</span>
            </div>
          </article>
        ))}
        {!loading && result && result.data.length === 0 ? (
          <p className="empty" data-testid="event-list-empty">
            No events to show.
          </p>
        ) : null}
        {loading && !result ? <p className="empty">Loading events…</p> : null}
      </section>

      <div className="pagination">
        <button
          className="button"
          type="button"
          data-testid="events-prev"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span
          className="pagination__label"
          data-testid="events-page"
          data-page={result?.page ?? page}
          data-page-count={pageCount}
          data-page-size={pageSize}
        >
          Page {result?.page ?? page} of {pageCount}
        </span>
        <button
          className="button"
          type="button"
          data-testid="events-next"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          Next
        </button>
      </div>
    </main>
  );
}
