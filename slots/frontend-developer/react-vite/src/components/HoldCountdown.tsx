import { useEffect, useState } from "react";
import { HOLD_TTL_SECONDS } from "../lib/contract";

function remainingSeconds(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / 1000));
}

function mmss(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Remaining hold TTL (`hold-countdown` in contract/testids.md). Default TTL is
 * 600s; the value shown is always derived from the server's `expires_at`, never
 * from a locally counted-down number, so clock drift cannot inflate it.
 */
export function HoldCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired?: () => void;
}): JSX.Element {
  const [left, setLeft] = useState(() => remainingSeconds(expiresAt));

  useEffect(() => {
    setLeft(remainingSeconds(expiresAt));
    const timer = window.setInterval(() => {
      const next = remainingSeconds(expiresAt);
      setLeft(next);
      if (next === 0) {
        window.clearInterval(timer);
        onExpired?.();
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // onExpired is intentionally excluded: it is a stable callback from the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const expired = left === 0;
  const pct = Math.min(100, Math.round((left * 100) / HOLD_TTL_SECONDS));

  return (
    <div
      className={`countdown${expired ? " countdown--expired" : ""}`}
      data-testid="hold-countdown"
      data-seconds-remaining={left}
      data-expires-at={expiresAt}
      role="timer"
      aria-live="off"
    >
      <span className="countdown__label">{expired ? "Hold expired" : "Hold expires in"}</span>
      <span className="countdown__value">{mmss(left)}</span>
      <span className="countdown__bar" aria-hidden="true">
        <span className="countdown__bar-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
