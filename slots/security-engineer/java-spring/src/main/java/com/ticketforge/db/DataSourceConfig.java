package com.ticketforge.db;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Builds the pool from {@code DATABASE_URL} (libpq form) or {@code JDBC_DATABASE_URL}.
 * Pool size 20.
 */
@Configuration
public class DataSourceConfig {

  @Bean
  public DataSource dataSource(
      @Value("${DATABASE_URL:${JDBC_DATABASE_URL:jdbc:postgresql://127.0.0.1:5432/ticketforge}}")
          String rawUrl,
      @Value("${PGUSER:}") String envUser,
      @Value("${PGPASSWORD:}") String envPassword) {
    DatabaseUrl parsed = DatabaseUrl.parse(rawUrl);

    HikariDataSource ds = new HikariDataSource();
    ds.setDriverClassName("org.postgresql.Driver");
    ds.setJdbcUrl(parsed.jdbcUrl());
    String user = parsed.username() != null ? parsed.username() : nullIfBlank(envUser);
    String password = parsed.password() != null ? parsed.password() : nullIfBlank(envPassword);
    if (user != null) {
      ds.setUsername(user);
    }
    if (password != null) {
      ds.setPassword(password);
    }
    ds.setMaximumPoolSize(20);
    ds.setMinimumIdle(2);
    ds.setPoolName("ticketforge");
    ds.setAutoCommit(true);
    ds.setConnectionTimeout(10_000);
    return ds;
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
