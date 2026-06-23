import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { ErrorBanner } from "../components/ErrorBanner";
import { MoneyBreakdown } from "../components/MoneyBreakdown";
import { api } from "../lib/api";
import type { Order } from "../lib/contract";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { useSignedInSession } from "../state/session";
import { colors, radius, space, type } from "../theme";

/**
 * The orders this install has placed.
 *
 * The contract has no "list my orders" endpoint, so the app remembers the ids it
 * created and re-reads each one with `GET /orders/{id}`. A single id that
 * 404s — an order placed by another install, say — is dropped rather than
 * failing the whole screen.
 */
export function OrdersScreen() {
  const { token, orderIds } = useSignedInSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const fetched = await Promise.all(
          orderIds.map(async (id) => {
            try {
              return await api.getOrder(token, id);
            } catch {
              return null;
            }
          }),
        );
        if (live) setOrders(fetched.filter((order): order is Order => order !== null));
      } catch (cause) {
        if (live) setError(toDisplayError(cause));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [token, orderIds]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text role="heading" style={styles.title}>
          Orders
        </Text>
        <Text style={styles.meta}>
          {orders.length} order{orders.length === 1 ? "" : "s"} on this device
        </Text>
      </View>

      <View style={styles.body}>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <View testID="order-list" style={styles.list}>
          <FlatList
            data={orders}
            keyExtractor={(order) => order.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View testID="order-card" dataSet={{ orderId: item.id }} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardId}>{item.id}</Text>
                  <Text style={styles.badge}>{item.status}</Text>
                </View>
                <Text style={styles.meta}>
                  {item.event_id} {"·"} {item.seat_ids.length} seat
                  {item.seat_ids.length === 1 ? "" : "s"}
                </Text>
                <MoneyBreakdown
                  idPrefix={`order-${item.id}`}
                  subtotalCents={item.subtotal_cents}
                  discountCents={item.discount_cents}
                  feeCents={item.fee_cents}
                  totalCents={item.total_cents}
                  currency={item.currency}
                />
              </View>
            )}
            ListEmptyComponent={
              loading ? (
                <Text style={styles.meta}>Loading orders{"…"}</Text>
              ) : (
                <Text testID="order-list-empty" style={styles.meta}>
                  No orders yet {"—"} hold some seats and check out.
                </Text>
              )
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, gap: 2 },
  title: { fontSize: type.title, fontWeight: "700", color: colors.text },
  meta: { fontSize: type.caption, color: colors.textMuted },
  body: { flex: 1, paddingHorizontal: space.lg, paddingBottom: space.lg },
  list: { flex: 1, minHeight: 120 },
  listContent: { gap: space.md },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardId: { fontSize: type.body, fontWeight: "600", color: colors.text },
  badge: {
    fontSize: type.micro,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
});
