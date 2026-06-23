package com.ticketforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.ticketforge.db.DatabaseUrl;
import org.junit.jupiter.api.Test;

/** The harness hands us libpq-style URLs; the driver needs JDBC ones. */
class DatabaseUrlTest {

  @Test
  void parsesLibpqUrlWithUserOnly() {
    DatabaseUrl url = DatabaseUrl.parse("postgres://tfadmin@127.0.0.1:32895/ticketforge_java");
    assertEquals("jdbc:postgresql://127.0.0.1:32895/ticketforge_java", url.jdbcUrl());
    assertEquals("tfadmin", url.username());
    assertNull(url.password());
  }

  @Test
  void parsesLibpqUrlWithPassword() {
    DatabaseUrl url =
        DatabaseUrl.parse("postgres://ticketforge:secret@localhost:5432/ticketforge");
    assertEquals("jdbc:postgresql://localhost:5432/ticketforge", url.jdbcUrl());
    assertEquals("ticketforge", url.username());
    assertEquals("secret", url.password());
  }

  @Test
  void picksUpCredentialsFromQueryParameters() {
    DatabaseUrl url =
        DatabaseUrl.parse("postgresql://127.0.0.1:32895/ticketforge_java?user=tfadmin");
    assertEquals("tfadmin", url.username());
  }

  @Test
  void passesJdbcUrlsThrough() {
    DatabaseUrl url = DatabaseUrl.parse("jdbc:postgresql://db:5432/tf?user=u");
    assertEquals("jdbc:postgresql://db:5432/tf?user=u", url.jdbcUrl());
  }

  @Test
  void defaultsThePort() {
    assertEquals(
        "jdbc:postgresql://localhost:5432/ticketforge",
        DatabaseUrl.parse("postgres://localhost/ticketforge").jdbcUrl());
  }
}
