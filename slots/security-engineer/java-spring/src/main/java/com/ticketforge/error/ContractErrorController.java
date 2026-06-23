package com.ticketforge.error;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Replaces Spring Boot's {@code BasicErrorController} (Whitelabel page / the
 * {@code timestamp,status,error,path} JSON) for anything the servlet container forwards
 * to {@code /error}. Everything leaving this application is the contract envelope.
 */
@RestController
public class ContractErrorController implements ErrorController {

  @RequestMapping("/error")
  public ResponseEntity<ErrorBody> handle(HttpServletRequest request) {
    Object rawStatus = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
    int status = rawStatus instanceof Integer i ? i : 500;
    ErrorCode code =
        switch (status) {
          case 400 -> ErrorCode.VALIDATION_ERROR;
          case 401 -> ErrorCode.UNAUTHENTICATED;
          case 403 -> ErrorCode.INSUFFICIENT_PERMISSION;
          case 404, 405, 406, 415 -> ErrorCode.NOT_FOUND;
          case 429 -> ErrorCode.RATE_LIMITED;
          default -> ErrorCode.INTERNAL_ERROR;
        };
    return ResponseEntity.status(code.status())
        .body(ErrorBody.of(code, messageFor(code)));
  }

  private static String messageFor(ErrorCode code) {
    return switch (code) {
      case VALIDATION_ERROR -> "Invalid request";
      case UNAUTHENTICATED -> "Authentication required";
      case INSUFFICIENT_PERMISSION -> "Insufficient permission";
      case NOT_FOUND -> "Resource not found";
      case RATE_LIMITED -> "Too many requests";
      default -> "Internal server error";
    };
  }
}
