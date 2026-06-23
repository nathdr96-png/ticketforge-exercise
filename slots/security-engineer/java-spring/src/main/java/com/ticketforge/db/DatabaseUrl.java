package com.ticketforge.db;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.net.URLDecoder;

/**
 * Accepts either a JDBC URL or the libpq-style {@code postgres://user:pass@host:port/db}
 * form used by {@code DATABASE_URL} across this monorepo and the conformance suite.
 */
public record DatabaseUrl(String jdbcUrl, String username, String password) {

  public static DatabaseUrl parse(String raw) {
    String value = raw == null ? "" : raw.trim();
    if (value.isEmpty()) {
      throw new IllegalArgumentException("DATABASE_URL / spring.datasource.url is required");
    }
    if (value.startsWith("jdbc:")) {
      return new DatabaseUrl(value, null, null);
    }
    if (!value.startsWith("postgres://") && !value.startsWith("postgresql://")) {
      throw new IllegalArgumentException("Unsupported database URL: " + value);
    }

    URI uri = URI.create(value);
    String host = uri.getHost() == null ? "127.0.0.1" : uri.getHost();
    int port = uri.getPort() == -1 ? 5432 : uri.getPort();
    String path = uri.getPath() == null ? "" : uri.getPath();
    String database = path.startsWith("/") ? path.substring(1) : path;
    if (database.isEmpty()) {
      database = "postgres";
    }

    String user = null;
    String pass = null;
    String userInfo = uri.getUserInfo();
    if (userInfo != null && !userInfo.isEmpty()) {
      int colon = userInfo.indexOf(':');
      if (colon >= 0) {
        user = decode(userInfo.substring(0, colon));
        pass = decode(userInfo.substring(colon + 1));
      } else {
        user = decode(userInfo);
      }
    }

    StringBuilder jdbc =
        new StringBuilder("jdbc:postgresql://").append(host).append(':').append(port)
            .append('/').append(database);
    // Carry through any query parameters (sslmode, application_name, ...).
    String query = uri.getRawQuery();
    if (query != null && !query.isEmpty()) {
      jdbc.append('?').append(query);
      // libpq allows user/password as query params too.
      for (String part : query.split("&")) {
        int eq = part.indexOf('=');
        if (eq <= 0) {
          continue;
        }
        String k = decode(part.substring(0, eq));
        String v = decode(part.substring(eq + 1));
        if ("user".equals(k) && user == null) {
          user = v;
        } else if ("password".equals(k) && pass == null) {
          pass = v;
        }
      }
    }
    return new DatabaseUrl(jdbc.toString(), user, pass);
  }

  private static String decode(String s) {
    return URLDecoder.decode(s, StandardCharsets.UTF_8);
  }
}
