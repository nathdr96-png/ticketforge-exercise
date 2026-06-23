import { ApiError } from "../lib/api";
import type { ErrorCode } from "../lib/contract";

export interface DisplayError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Normalise anything thrown into the contract error envelope shape. */
export function toDisplayError(err: unknown): DisplayError {
  if (err instanceof ApiError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return {
    code: "INTERNAL_ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * The single `error-banner` in the app (contract/testids.md requires
 * `data-error-code`). Exactly one is rendered at a time so Playwright's strict
 * mode always resolves it unambiguously.
 */
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: DisplayError | null;
  onDismiss?: () => void;
}): JSX.Element | null {
  if (!error) return null;
  const details = error.details && Object.keys(error.details).length > 0 ? error.details : null;
  return (
    <div
      className="error-banner"
      role="alert"
      data-testid="error-banner"
      data-error-code={error.code}
    >
      <div className="error-banner__body">
        <span className="error-banner__code">{error.code}</span>
        <span className="error-banner__message">{error.message}</span>
        {details ? (
          <span className="error-banner__details">{JSON.stringify(details)}</span>
        ) : null}
      </div>
      {onDismiss ? (
        <button type="button" className="error-banner__close" onClick={onDismiss} aria-label="Dismiss error">
          ×
        </button>
      ) : null}
    </div>
  );
}
