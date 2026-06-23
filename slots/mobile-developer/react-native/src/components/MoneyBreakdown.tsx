import { StyleSheet, Text, View } from "react-native";

import type { Cents } from "../lib/contract";
import { formatMoney } from "../lib/money";
import { colors, radius, space, type } from "../theme";

/**
 * Subtotal / discount / fee / total.
 *
 * Every row carries `data-cents` with the integer the API returned (or, for the
 * pre-order preview, the integer the contract formula produced) alongside the
 * formatted string. The two must agree to the cent: the suite reads the
 * attribute and the customer reads the text, and a bug that makes them disagree
 * is the bug a customer reports.
 */
export function MoneyBreakdown({
  idPrefix,
  subtotalCents,
  discountCents,
  feeCents,
  totalCents,
  currency,
  totalTestID,
  note,
}: {
  /**
   * `checkout` for the quote, `order` for the confirmed order. The orders list
   * passes a per-order prefix instead, so a screen that shows several orders
   * does not render the contract's `order-*` ids more than once.
   */
  idPrefix: string;
  subtotalCents: Cents;
  discountCents: Cents;
  feeCents: Cents;
  totalCents: Cents;
  currency: string;
  totalTestID?: string;
  note?: string;
}) {
  return (
    <View testID={`${idPrefix}-breakdown`} style={styles.block}>
      <Row
        testID={`${idPrefix}-subtotal`}
        label="Subtotal"
        cents={subtotalCents}
        text={formatMoney(subtotalCents, currency)}
      />
      <Row
        testID={`${idPrefix}-discount`}
        label="Discount"
        cents={discountCents}
        text={
          discountCents > 0
            ? `−${formatMoney(discountCents, currency)}`
            : formatMoney(0, currency)
        }
      />
      <Row
        testID={`${idPrefix}-fee`}
        label="Service fee"
        cents={feeCents}
        text={formatMoney(feeCents, currency)}
      />
      <Row
        testID={totalTestID ?? `${idPrefix}-total`}
        label="Total"
        cents={totalCents}
        text={formatMoney(totalCents, currency)}
        emphasis
      />
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function Row({
  testID,
  label,
  cents,
  text,
  emphasis = false,
}: {
  testID: string;
  label: string;
  cents: Cents;
  text: string;
  emphasis?: boolean;
}) {
  return (
    <View style={[styles.row, emphasis ? styles.rowTotal : null]}>
      <Text style={[styles.label, emphasis ? styles.emphasis : null]}>{label}</Text>
      <Text
        testID={testID}
        dataSet={{ cents }}
        style={[styles.value, emphasis ? styles.emphasis : null]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  rowTotal: {
    marginTop: space.xs,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  label: { fontSize: type.body, color: colors.textMuted },
  value: { fontSize: type.body, color: colors.text },
  emphasis: { fontSize: type.heading, fontWeight: "700", color: colors.text },
  note: { marginTop: space.xs, fontSize: type.caption, color: colors.textMuted },
});
