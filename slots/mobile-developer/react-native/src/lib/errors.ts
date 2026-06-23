/**
 * Anything thrown -> the shape the error banner renders.
 *
 * The code and the message stay separate fields all the way to the screen. That
 * is what makes `[object Object]` impossible: nothing ever interpolates an
 * envelope into a string.
 */

import { ApiError } from "./api";
import type { ErrorCode } from "./contract";

export interface DisplayError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function toDisplayError(cause: unknown): DisplayError {
  if (cause instanceof ApiError) {
    return { code: cause.code, message: cause.message, details: cause.details };
  }
  return {
    code: "INTERNAL_ERROR",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}
