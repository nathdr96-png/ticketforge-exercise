import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../components/AppButton";
import { ErrorBanner } from "../components/ErrorBanner";
import { SelectField } from "../components/SelectField";
import type { Paged, TfEvent } from "../lib/contract";
import { api } from "../lib/api";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { navigate } from "../lib/navigation";
import { useSignedInSession } from "../state/session";
import { colors, radius, space, type } from "../theme";

const DEFAULT_PAGE_SIZE = 10;

/**
 * Selectable page sizes.
 *
 * The small ones are not decoration. A catalogue with a handful of published
 * events still has to be navigable page by page, and the conformance suite
 * drives pagination through this control rather than assuming how much seed
 * data a deployment happens to carry.
 */
const PAGE_SIZES = ["2", "5", "10", "25"] as const;

function formatStartsAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  // The contract's timestamps are UTC, and an event time that silently shifts
  // with the device's zone is a support ticket. Shown as UTC, labelled as UTC.
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function EventsScreen() {
  const { token } = useSignedInSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<Paged<TfEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  const load = useCallback(
    async (wantedPage: number, wantedPageSize: number) => {
      setLoading(true);
      setError(null);
      try {
        setResult(await api.listEvents(token, wantedPage, wantedPageSize));
      } catch (cause) {
        setError(toDisplayError(cause));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(page, pageSize);
  }, [load, page, pageSize]);

  const total = result?.total ?? 0;
  const servedPageSize = result?.page_size ?? pageSize;
  const pageCount = Math.max(1, Math.ceil(total / servedPageSize));
  const currentPage = result?.page ?? page;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text role="heading" style={styles.title}>
            Events
          </Text>
          <Text testID="event-total" dataSet={{ total }} style={styles.meta}>
            {total} event{total === 1 ? "" : "s"}
          </Text>
        </View>
        <SelectField
          label="Per page"
          testID="events-page-size"
          value={String(pageSize)}
          options={PAGE_SIZES.map((size) => ({ value: size, label: `${size} per page` }))}
          onChange={(next) => {
            // Back to page 1: staying on page 4 of a list that now has two
            // pages would show an empty screen and read as a broken app.
            setPage(1);
            setPageSize(Number(next));
          }}
        />
      </View>

      <View style={styles.body}>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {/* Rendered unconditionally so the list is addressable while loading. */}
        <View testID="event-list" aria-live="polite" style={styles.list}>
          <FlatList
            data={result?.data ?? []}
            keyExtractor={(event) => event.id}
            renderItem={({ item }) => <EventCard event={item} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              loading ? (
                <View style={styles.placeholder}>
                  <ActivityIndicator accessibilityLabel="Loading events" />
                </View>
              ) : (
                <Text testID="event-list-empty" style={styles.placeholderText}>
                  No events to show.
                </Text>
              )
            }
          />
        </View>
      </View>

      <View style={styles.pagination}>
        <AppButton
          testID="events-prev"
          label="Previous"
          disabled={currentPage <= 1 || loading}
          onPress={() => setPage((current) => Math.max(1, current - 1))}
        />
        <Text
          testID="events-page"
          dataSet={{ page: currentPage, pageCount, pageSize: servedPageSize }}
          style={styles.pageLabel}
        >
          Page {currentPage} of {pageCount}
        </Text>
        <AppButton
          testID="events-next"
          label="Next"
          disabled={currentPage >= pageCount || loading}
          onPress={() => setPage((current) => Math.min(pageCount, current + 1))}
        />
      </View>
    </View>
  );
}

function EventCard({ event }: { event: TfEvent }) {
  return (
    <Pressable
      testID="event-card"
      dataSet={{ eventId: event.id, status: event.status }}
      role="button"
      accessibilityLabel={`${event.title} at ${event.venue}`}
      onPress={() => navigate({ name: "event", eventId: event.id })}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle}>{event.title}</Text>
        <Text style={styles.cardMeta}>
          {event.venue} {"·"} {formatStartsAt(event.starts_at)}
        </Text>
        {event.description ? (
          <Text numberOfLines={2} style={styles.cardDescription}>
            {event.description}
          </Text>
        ) : null}
      </View>
      <View style={styles.cardSide}>
        <Text style={styles.badge}>{event.status}</Text>
        <Text style={styles.cardPrice}>
          from {formatMoney(event.base_price_cents, event.currency)}
        </Text>
        <Text style={styles.cardMeta}>{event.seat_count} seats</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  headerText: { gap: 2 },
  title: { fontSize: type.title, fontWeight: "700", color: colors.text },
  meta: { fontSize: type.caption, color: colors.textMuted },
  body: { flex: 1, paddingHorizontal: space.lg },
  list: { flex: 1, minHeight: 120 },
  listContent: { gap: space.md, paddingBottom: space.lg },
  placeholder: { padding: space.xl, alignItems: "center" },
  placeholderText: { padding: space.lg, fontSize: type.body, color: colors.textMuted },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  cardPressed: { backgroundColor: colors.selectedSurface },
  cardMain: { flex: 1, gap: space.xs },
  cardTitle: { fontSize: type.heading, fontWeight: "700", color: colors.text },
  cardMeta: { fontSize: type.caption, color: colors.textMuted },
  cardDescription: { fontSize: type.caption, color: colors.textMuted },
  cardSide: { alignItems: "flex-end", gap: space.xs },
  badge: {
    fontSize: type.micro,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardPrice: { fontSize: type.body, fontWeight: "600", color: colors.text },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  pageLabel: { fontSize: type.body, color: colors.textMuted },
});
