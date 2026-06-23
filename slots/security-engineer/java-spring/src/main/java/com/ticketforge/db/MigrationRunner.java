package com.ticketforge.db;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Applies {@code contract/schema.sql} verbatim. No ORM ever generates this schema
 * ({@code spring.jpa.hibernate.ddl-auto=none}; JPA isn't even on the classpath) — the
 * canonical DDL is the single source of truth.
 *
 * <p>The public schema is dropped and recreated first so repeated
 * migrate+seed cycles are deterministic.
 */
@Component
public class MigrationRunner {

  private static final Logger log = LoggerFactory.getLogger(MigrationRunner.class);

  private final JdbcTemplate jdbc;
  private final ContractLocator contract;

  public MigrationRunner(JdbcTemplate jdbc, ContractLocator contract) {
    this.jdbc = jdbc;
    this.contract = contract;
  }

  public void migrate() {
    Path schema = contract.schemaSql();
    String sql;
    try {
      sql = Files.readString(schema, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read " + schema, e);
    }

    jdbc.execute("DROP SCHEMA public CASCADE");
    jdbc.execute("CREATE SCHEMA public");
    jdbc.execute("GRANT ALL ON SCHEMA public TO public");
    // schema.sql is a single BEGIN/COMMIT script — hand it to the server as one statement
    // batch so it is applied exactly as written.
    jdbc.execute(sql);
    log.info("Migrated schema from {}", schema);
  }
}
