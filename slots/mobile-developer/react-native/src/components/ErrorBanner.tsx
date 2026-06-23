import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DisplayError } from "../lib/errors";
import { colors, radius, space, type } from "../theme";

/**
 * The app's one error banner (`error-banner` in contract/testids.md, with
 * `data-error-code`).
 *
 * The code and the message are separate `Text` children, never a template
 * string over the envelope, which is what makes `[object Object]` unreachable.
 * Exactly one banner is mounted at a time — each screen renders at most one and
 * only one screen is mounted — so a selector always resolves to one node.
 */
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: DisplayError | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  const details =
    error.details && Object.keys(error.details).length > 0 ? JSON.stringify(error.details) : null;

  return (
    <View
      testID="error-banner"
      dataSet={{ errorCode: error.code }}
      role="alert"
      style={styles.banner}
    >
      <View style={styles.body}>
        <Text style={styles.code}>{error.code}</Text>
        <Text style={styles.message}>{error.message}</Text>
        {details ? <Text style={styles.details}>{details}</Text> : null}
      </View>
      {onDismiss ? (
        <Pressable
          role="button"
          accessibilityLabel="Dismiss error"
          hitSlop={8}
          onPress={onDismiss}
          style={styles.dismiss}
        >
          <Text style={styles.dismissLabel}>{"×"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.dangerSurface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
    gap: space.sm,
  },
  body: { flex: 1, gap: 2 },
  code: {
    fontSize: type.caption,
    fontWeight: "700",
    color: colors.danger,
    letterSpacing: 0.4,
  },
  message: { fontSize: type.body, color: colors.text },
  details: { fontSize: type.caption, color: colors.textMuted },
  dismiss: { paddingHorizontal: space.sm, paddingVertical: 2 },
  dismissLabel: { fontSize: type.heading, color: colors.danger, lineHeight: 18 },
});
