package com.ticketforge.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

/**
 * Replaces Spring Security's default 401 handling (which sends an empty body and a
 * {@code WWW-Authenticate} challenge) with the contract envelope
 * {@code {"error":{"code":"UNAUTHENTICATED",...}}}.
 */
@Component
public class ContractAuthenticationEntryPoint implements AuthenticationEntryPoint {

  private final ObjectMapper mapper;

  public ContractAuthenticationEntryPoint(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  @Override
  public void commence(
      HttpServletRequest request, HttpServletResponse response, AuthenticationException ex)
      throws IOException {
    ContractErrorWriter.write(
        mapper, response, ErrorCode.UNAUTHENTICATED, "Authentication required");
  }
}
