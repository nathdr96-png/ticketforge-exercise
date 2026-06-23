package com.ticketforge.error;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Forces every error that escapes a controller into the contract envelope.
 *
 * <p>Spring's defaults (Whitelabel page / {@code DefaultErrorAttributes}, which emit
 * {@code timestamp/status/error/path}) would not match {@code contract/errors.md}, so the
 * advice below plus {@link ContractAuthenticationEntryPoint},
 * {@link ContractAccessDeniedHandler} and {@link ContractErrorController} cover all three
 * routes an error can take out of the application.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  private static ResponseEntity<ErrorBody> body(ErrorCode code, String message) {
    return ResponseEntity.status(code.status()).body(ErrorBody.of(code, message));
  }

  @ExceptionHandler(AppException.class)
  public ResponseEntity<ErrorBody> handleApp(AppException ex) {
    return ResponseEntity.status(ex.getStatus()).body(ex.toBody());
  }

  /** Malformed/absent JSON body, wrong types inside the body. */
  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentNotValidException.class,
    MissingServletRequestParameterException.class,
    MethodArgumentTypeMismatchException.class,
    HttpMediaTypeNotSupportedException.class,
    IllegalArgumentException.class
  })
  public ResponseEntity<ErrorBody> handleValidation(Exception ex) {
    return body(ErrorCode.VALIDATION_ERROR, firstLine(ex.getMessage(), "Invalid request"));
  }

  /** Unknown route or wrong method — must still be the contract envelope, never Whitelabel. */
  @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
  public ResponseEntity<ErrorBody> handleNoHandler(Exception ex) {
    return body(ErrorCode.NOT_FOUND, "Resource not found");
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<ErrorBody> handleMethod(HttpRequestMethodNotSupportedException ex) {
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
        .body(ErrorBody.of(ErrorCode.NOT_FOUND, "Method not allowed"));
  }

  /** Spring Security exceptions that surface after the filter chain. */
  @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
  public ResponseEntity<ErrorBody> handleAccessDenied(Exception ex) {
    return body(ErrorCode.INSUFFICIENT_PERMISSION, "Insufficient permission");
  }

  @ExceptionHandler(org.springframework.security.core.AuthenticationException.class)
  public ResponseEntity<ErrorBody> handleAuth(Exception ex) {
    return body(ErrorCode.UNAUTHENTICATED, "Authentication required");
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorBody> handleUnexpected(Exception ex, HttpServletRequest req) {
    log.error("Unhandled error on {} {}", req.getMethod(), req.getRequestURI(), ex);
    return body(ErrorCode.INTERNAL_ERROR, "Internal server error");
  }

  private static String firstLine(String message, String fallback) {
    if (message == null || message.isBlank()) {
      return fallback;
    }
    int nl = message.indexOf('\n');
    String line = nl >= 0 ? message.substring(0, nl) : message;
    return line.length() > 300 ? line.substring(0, 300) : line;
  }
}
