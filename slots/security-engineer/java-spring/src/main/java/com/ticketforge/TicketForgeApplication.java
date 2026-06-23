package com.ticketforge;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * TicketForge backend — Java 21 / Spring Boot 3 / JdbcTemplate.
 *
 * <p>Behaviour follows {@code contract/openapi.yaml}. No JPA/Hibernate is on the classpath: the
 * canonical DDL in {@code contract/schema.sql} is applied verbatim by
 * {@link com.ticketforge.db.MigrationRunner} and every query is explicit SQL so
 * that the {@code SELECT ... FOR UPDATE} locking strategy stays reviewable.
 */
@SpringBootApplication(
    // We authenticate from the users table via a JWT filter, so Spring Security's
    // in-memory default user (and its generated password) must not exist at all.
    exclude = {
      org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class
    })
@EnableScheduling
public class TicketForgeApplication {

  public static void main(String[] args) {
    // `--app.task=migrate|seed` runs a one-shot CLI task with no web server.
    boolean cliTask = false;
    for (String arg : args) {
      if (arg.startsWith("--app.task=") && !arg.endsWith("=none") && !arg.endsWith("=")) {
        cliTask = true;
      }
    }
    SpringApplicationBuilder builder = new SpringApplicationBuilder(TicketForgeApplication.class);
    if (cliTask) {
      builder.web(org.springframework.boot.WebApplicationType.NONE);
    }
    builder.run(args);
  }
}
