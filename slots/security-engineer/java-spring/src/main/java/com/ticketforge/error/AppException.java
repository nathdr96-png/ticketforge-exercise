package com.ticketforge.error;

import java.util.LinkedHashMap;
import java.util.Map;

/** A contract error: an {@link ErrorCode}, a message and optional details. */
public class AppException extends RuntimeException {

  private final ErrorCode code;
  private final Map<String, Object> details;

  public AppException(ErrorCode code, String message) {
    this(code, message, null);
  }

  public AppException(ErrorCode code, String message, Map<String, Object> details) {
    super(message);
    this.code = code;
    this.details = details;
  }

  public static AppException of(ErrorCode code, String message, String detailKey, Object value) {
    Map<String, Object> d = new LinkedHashMap<>();
    d.put(detailKey, value);
    return new AppException(code, message, d);
  }

  public ErrorCode getCode() {
    return code;
  }

  public int getStatus() {
    return code.status();
  }

  public Map<String, Object> getDetails() {
    return details;
  }

  public ErrorBody toBody() {
    return ErrorBody.of(code, getMessage(), details);
  }
}
