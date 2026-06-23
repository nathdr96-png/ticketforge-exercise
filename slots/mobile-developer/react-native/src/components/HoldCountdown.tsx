import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { HOLD_TTL_SECONDS } from "../lib/contract";
import { colors, radius, space, type } from "../theme";

/**
 * Whole seconds left on a hold.
 *
 * The server's `expires_at` is a UTC ISO-8601 instant and it is the ONLY input:
 * the value is recomputed from it on every tick rather than decremented from a
 * starting number, so a backgrounded app, a throttled timer or a device clock
 * that drifts cannot inflate the time a buyer believes they have. `Date.parse`
 * of a string with a `Z` offset is an absolute instant in every engine —
 * JavaScriptCore, Hermes and V8 alike — which is what makes the answer the same
 * in Berlin, New York and on a CI box pinned to UTC.
 */
function secondsLeft(expiresAtUtc: string, nowMs: number): number {
  const expiresMs = Date.parse(expiresAtUtc);
  if (Number.isNaN(expiresMs)) return 0;
  return Math.max(0, Math.ceil((expiresMs - nowMs) / 1000));
}

/** `600` -> `"10:00"`. Zero-padded so the width never jumps as it counts down. */
export function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value));
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * `hold-countdown` in contract/testids.md, with `data-seconds-remaining`.
 *
 * On a device this is also the only thing standing between the buyer and a seat
 * that quietly disappears, so it keeps ticking while the checkout sheet is open
 * and tells the screen once, when it reaches zero.
 */
export function HoldCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsLeft(expiresAt, Date.now()));
  // Kept in a ref so a new callback identity does not restart the ticker.
  const notify = useRef(onExpired);
  notify.current = onExpired;

  useEffect(() => {
    setRemaining(secondsLeft(expiresAt, Date.now()));
    const ticker = setInterval(() => {
      const next = secondsLeft(expiresAt, Date.now());
      setRemaining(next);
      if (next === 0) {
        clearInterval(ticker);
        notify.current?.();
      }
    }, 1000);
    return () => clearInterval(ticker);
  }, [expiresAt]);

  const expired = remaining === 0;
  const fraction = Math.max(0, Math.min(1, remaining / HOLD_TTL_SECONDS));

  return (
    <View
      testID="hold-countdown"
      dataSet={{ secondsRemaining: remaining, expiresAt }}
      role="timer"
      aria-live="off"
      style={[styles.block, expired ? styles.blockExpired : null]}
    >
      <View style={styles.headline}>
        <Text style={styles.label}>{expired ? "Hold expired" : "Hold expires in"}</Text>
        <Text style={[styles.value, expired ? styles.valueExpired : null]}>
          {formatRemaining(remaining)}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            // A percentage width is the one place a fraction is harmless: it is
            // a pixel measurement, not money.
            { width: `${Math.round(fraction * 100)}%` },
            expired ? styles.fillExpired : null,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderWidth: 1,
    borderColor: colors.held,
    backgroundColor: colors.heldSurface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  blockExpired: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  headline: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: { fontSize: type.caption, fontWeight: "600", color: colors.textMuted },
  value: { fontSize: type.title, fontWeight: "700", color: colors.text },
  valueExpired: { color: colors.danger },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: 4, backgroundColor: colors.held },
  fillExpired: { backgroundColor: colors.danger },
});
