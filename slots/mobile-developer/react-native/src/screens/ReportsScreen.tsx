import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ErrorBanner } from "../components/ErrorBanner";
import { api } from "../lib/api";
import type { RevenueReport } from "../lib/contract";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { useSignedInSession } from "../state/session";
import { colors, radius, space, type } from "../theme";

/**
 * Revenue, for organizers and admins.
 *
 * A buyer has no tab to this screen, but the screen is still mounted if they
 * deep-link to it — and that is the point. What refuses them is the API's
 * `INSUFFICIENT_PERMISSION`, surfaced in the banner, with no figures rendered.
 * A client-side redirect would only hide the route from the people who do not
 * know it is there.
 */
export function ReportsScreen() {
  const { token, user, canSeeReports } = useSignedInSession();
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const fetched = await api.revenueReport(token);
        if (live) setReport(fetched);
      } catch (cause) {
        if (live) {
          setReport(null);
          setError(toDisplayError(cause));
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text role="heading" style={styles.title}>
          Revenue
        </Text>
        <Text style={styles.meta}>
          {user.email} {"·"} {user.role}
        </Text>
      </View>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {!canSeeReports && !error ? (
        <Text testID="revenue-forbidden" style={styles.meta}>
          Revenue reporting is available to organizers and admins only.
        </Text>
      ) : null}

      {loading ? <Text style={styles.meta}>Loading revenue{"…"}</Text> : null}

      {report ? (
        <View
          testID="revenue-report"
          dataSet={{ currency: report.currency }}
          style={styles.card}
        >
          <View style={styles.stats}>
            <Stat testID="revenue-gross" label="Gross" cents={report.gross_cents} currency={report.currency} />
            <Stat testID="revenue-fees" label="Fees" cents={report.fees_cents} currency={report.currency} />
            <Stat
              testID="revenue-discounts"
              label="Discounts"
              cents={report.discounts_cents}
              currency={report.currency}
            />
            <Stat testID="revenue-net" label="Net" cents={report.net_cents} currency={report.currency} />
          </View>

          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[styles.cell, styles.cellWide, styles.cellHead]}>Event</Text>
              <Text style={[styles.cell, styles.cellHead]}>Orders</Text>
              <Text style={[styles.cell, styles.cellHead]}>Gross</Text>
              <Text style={[styles.cell, styles.cellHead]}>Net</Text>
            </View>
            {report.by_event.length === 0 ? (
              <Text style={styles.meta}>No orders in range yet.</Text>
            ) : (
              report.by_event.map((row) => (
                <View
                  key={row.event_id}
                  testID="revenue-row"
                  dataSet={{ eventId: row.event_id }}
                  style={styles.tableRow}
                >
                  <Text style={[styles.cell, styles.cellWide]}>{row.event_id}</Text>
                  <Text style={styles.cell}>{row.order_count}</Text>
                  <Text dataSet={{ cents: row.gross_cents }} style={styles.cell}>
                    {formatMoney(row.gross_cents, report.currency)}
                  </Text>
                  <Text dataSet={{ cents: row.net_cents }} style={styles.cell}>
                    {formatMoney(row.net_cents, report.currency)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Stat({
  testID,
  label,
  cents,
  currency,
}: {
  testID: string;
  label: string;
  cents: number;
  currency: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text testID={testID} dataSet={{ cents }} style={styles.statValue}>
        {formatMoney(cents, currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, gap: space.md },
  header: { gap: 2 },
  title: { fontSize: type.title, fontWeight: "700", color: colors.text },
  meta: { fontSize: type.caption, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.lg,
  },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: space.lg },
  stat: { minWidth: 120, gap: 2 },
  statLabel: {
    fontSize: type.micro,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  statValue: { fontSize: type.heading, fontWeight: "700", color: colors.text },
  table: { gap: space.xs },
  tableRow: { flexDirection: "row", gap: space.sm, paddingVertical: space.xs },
  tableHead: { borderBottomWidth: 1, borderBottomColor: colors.border },
  cell: { flex: 1, fontSize: type.caption, color: colors.text },
  cellWide: { flex: 3 },
  cellHead: { fontWeight: "700", color: colors.textMuted },
});
