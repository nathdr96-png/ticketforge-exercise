/**
 * Everything the UI displays as an error goes through here first.
 *
 * `error-banner` in contract/testids.md must carry a `data-error-code`, and the
 * conformance suite explicitly refuses a banner that renders `[object Object]`
 * or an empty string. So an error is normalised into a code plus a human
 * message before it reaches a template, and anything that is not an `ApiError`
 * is reported under `INTERNAL_ERROR` rather than being stringified blindly.
 */

import { ApiError } from "./api";
import type { ErrorCode } from "./contract";

export interface DisplayError {
  code: ErrorCode;
  message: string;
  details: string | null;
}

function describeDetails(details: Record<string, unknown> | undefined): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  return Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
}

export function toDisplayError(cause: unknown): DisplayError {
  if (cause instanceof ApiError) {
    return {
      code: cause.code,
      message: cause.message || cause.code,
      details: describeDetails(cause.details),
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: cause instanceof Error ? cause.message : String(cause),
    details: null,
  };
}
