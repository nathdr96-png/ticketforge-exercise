package com.ticketforge.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Writes the contract error envelope straight onto a servlet response. */
public final class ContractErrorWriter {

  private ContractErrorWriter() {}

  public static void write(
      ObjectMapper mapper, HttpServletResponse response, ErrorCode code, String message)
      throws IOException {
    if (response.isCommitted()) {
      return;
    }
    response.reset();
    response.setStatus(code.status());
    response.setContentType("application/json");
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    byte[] payload =
        mapper.writeValueAsBytes(ErrorBody.of(code, message)).clone();
    response.setContentLength(payload.length);
    response.getOutputStream().write(payload);
    response.flushBuffer();
  }
}
