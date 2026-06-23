package com.ticketforge.config;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.time.format.DateTimeFormatter;
import java.time.ZoneOffset;

/**
 * UTC ISO-8601 with exactly millisecond precision and a {@code Z} suffix —
 * byte-identical to JavaScript's {@code Date#toISOString()}
 * (e.g. {@code 2026-06-15T19:00:00.000Z}).
 */
public final class Iso {

  private static final DateTimeFormatter FMT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

  private Iso() {}

  public static String format(Instant instant) {
    if (instant == null) {
      return null;
    }
    return FMT.format(instant.truncatedTo(ChronoUnit.MILLIS));
  }

  public static String format(java.sql.Timestamp ts) {
    return ts == null ? null : format(ts.toInstant());
  }

  public static String format(java.time.OffsetDateTime odt) {
    return odt == null ? null : format(odt.toInstant());
  }
}
