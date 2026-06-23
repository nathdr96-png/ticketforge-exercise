package com.ticketforge.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

/**
 * The one and only error envelope, exactly as specified by {@code contract/errors.md}:
 *
 * <pre>
 * { "error": { "code": "...", "message": "...", "details": { } } }
 * </pre>
 *
 * {@code details} is omitted when absent (it is optional in the contract).
 */
public record ErrorBody(Error error) {

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Error(String code, String message, Map<String, Object> details) {}

  public static ErrorBody of(ErrorCode code, String message, Map<String, Object> details) {
    return new ErrorBody(new Error(code.name(), message, details));
  }

  public static ErrorBody of(ErrorCode code, String message) {
    return of(code, message, null);
  }
}
