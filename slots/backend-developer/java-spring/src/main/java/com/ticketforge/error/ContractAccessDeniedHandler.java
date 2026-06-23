package com.ticketforge.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

/**
 * Replaces Spring Security's default 403 page with the contract envelope
 * {@code {"error":{"code":"INSUFFICIENT_PERMISSION",...}}}.
 */
@Component
public class ContractAccessDeniedHandler implements AccessDeniedHandler {

  private final ObjectMapper mapper;

  public ContractAccessDeniedHandler(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  @Override
  public void handle(
      HttpServletRequest request, HttpServletResponse response, AccessDeniedException ex)
      throws IOException {
    ContractErrorWriter.write(
        mapper, response, ErrorCode.INSUFFICIENT_PERMISSION, "Insufficient permission");
  }
}
