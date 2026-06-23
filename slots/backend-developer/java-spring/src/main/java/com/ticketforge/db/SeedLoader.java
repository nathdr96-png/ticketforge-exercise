package com.ticketforge.db;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deterministic loader for {@code contract/seed/seed.json} + {@code contract/seed/seats.json}.
 * Rows are inserted in fixture order; the shared password is bcrypt-hashed once at cost 10,
 * as {@code seed.json#meta.notes} requires.
 */
@Component
public class SeedLoader {

  private static final Logger log = LoggerFactory.getLogger(SeedLoader.class);

  private final JdbcTemplate jdbc;
  private final ContractLocator contract;
  private final PasswordEncoder passwordEncoder;
  private final ObjectMapper mapper;
  private final MigrationRunner migrationRunner;

  public SeedLoader(
      JdbcTemplate jdbc,
      ContractLocator contract,
      PasswordEncoder passwordEncoder,
      ObjectMapper mapper,
      MigrationRunner migrationRunner) {
    this.jdbc = jdbc;
    this.contract = contract;
    this.passwordEncoder = passwordEncoder;
    this.mapper = mapper;
    this.migrationRunner = migrationRunner;
  }

  /** Migrate (drop + apply contract DDL) then load the fixtures. */
  public void migrateAndSeed() {
    migrationRunner.migrate();
    seed();
  }

  @Transactional
  public void seed() {
    Path seedDir = contract.seedDir();
    JsonNode seedJson = read(seedDir.resolve("seed.json"));
    JsonNode seatsJson = read(seedDir.resolve("seats.json"));

    String password = seedJson.path("meta").path("password_for_all_users").asText("password123");
    String hash = passwordEncoder.encode(password);

    List<JsonNode> users = list(seedJson.path("users"));
    jdbc.batchUpdate(
        "INSERT INTO users (id, email, password_hash, role, name) VALUES (?,?,?,?::user_role,?)",
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(PreparedStatement ps, int i) throws SQLException {
            JsonNode u = users.get(i);
            ps.setString(1, u.path("id").asText());
            ps.setString(2, u.path("email").asText());
            ps.setString(3, hash);
            ps.setString(4, u.path("role").asText());
            ps.setString(5, u.path("name").asText());
          }

          @Override
          public int getBatchSize() {
            return users.size();
          }
        });

    List<JsonNode> events = list(seedJson.path("events"));
    jdbc.batchUpdate(
        """
        INSERT INTO events
          (id, organizer_id, title, description, venue, starts_at, currency,
           base_price_cents, status)
        VALUES (?,?,?,?,?,?,?,?,?::event_status)
        """,
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(PreparedStatement ps, int i) throws SQLException {
            JsonNode e = events.get(i);
            ps.setString(1, e.path("id").asText());
            ps.setString(2, e.path("organizer_id").asText());
            ps.setString(3, e.path("title").asText());
            ps.setString(4, e.path("description").asText(""));
            ps.setString(5, e.path("venue").asText());
            ps.setObject(
                6, OffsetDateTime.parse(e.path("starts_at").asText()), Types.TIMESTAMP_WITH_TIMEZONE);
            ps.setString(7, e.path("currency").asText());
            ps.setInt(8, e.path("base_price_cents").asInt());
            ps.setString(9, e.path("status").asText());
          }

          @Override
          public int getBatchSize() {
            return events.size();
          }
        });

    List<JsonNode> seats = list(seatsJson.path("seats"));
    jdbc.batchUpdate(
        """
        INSERT INTO seats (id, event_id, section, row_label, number, status, price_cents)
        VALUES (?,?,?::seat_section,?,?,?::seat_status,?)
        """,
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(PreparedStatement ps, int i) throws SQLException {
            JsonNode s = seats.get(i);
            ps.setString(1, s.path("id").asText());
            ps.setString(2, s.path("event_id").asText());
            ps.setString(3, s.path("section").asText());
            ps.setString(4, s.path("row").asText());
            ps.setInt(5, s.path("number").asInt());
            ps.setString(6, s.path("status").asText("available"));
            ps.setInt(7, s.path("price_cents").asInt());
          }

          @Override
          public int getBatchSize() {
            return seats.size();
          }
        });

    List<JsonNode> discounts = list(seedJson.path("discounts"));
    jdbc.batchUpdate(
        "INSERT INTO discounts (code, percent_off, active, stackable, event_id) VALUES (?,?,?,?,?)",
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(PreparedStatement ps, int i) throws SQLException {
            JsonNode d = discounts.get(i);
            ps.setString(1, d.path("code").asText());
            ps.setInt(2, d.path("percent_off").asInt());
            ps.setBoolean(3, d.path("active").asBoolean(true));
            ps.setBoolean(4, d.path("stackable").asBoolean(false));
            JsonNode eventId = d.path("event_id");
            if (eventId.isNull() || eventId.isMissingNode()) {
              ps.setNull(5, Types.VARCHAR);
            } else {
              ps.setString(5, eventId.asText());
            }
          }

          @Override
          public int getBatchSize() {
            return discounts.size();
          }
        });

    log.info(
        "Seeded {} users, {} events, {} seats, {} discounts",
        users.size(),
        events.size(),
        seats.size(),
        discounts.size());
  }

  private JsonNode read(Path path) {
    try {
      return mapper.readTree(Files.readString(path));
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read seed fixture " + path, e);
    }
  }

  private static List<JsonNode> list(JsonNode array) {
    List<JsonNode> out = new ArrayList<>();
    if (array != null && array.isArray()) {
      array.forEach(out::add);
    }
    return out;
  }
}
