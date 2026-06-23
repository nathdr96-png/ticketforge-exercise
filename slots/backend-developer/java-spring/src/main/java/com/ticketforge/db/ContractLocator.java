package com.ticketforge.db;

import com.ticketforge.config.AppProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.stereotype.Component;

/**
 * Finds the repo's {@code contract/} directory. Checked in order: the
 * {@code ticketforge.contract-dir} property / {@code CONTRACT_DIR} env, then by walking up
 * from the working directory looking for {@code contract/schema.sql}.
 */
@Component
public class ContractLocator {

  private final AppProperties props;

  public ContractLocator(AppProperties props) {
    this.props = props;
  }

  public Path contractDir() {
    String configured = props.getContractDir();
    if (configured != null && !configured.isBlank()) {
      Path p = Paths.get(configured).toAbsolutePath().normalize();
      if (Files.isRegularFile(p.resolve("schema.sql"))) {
        return p;
      }
      throw new IllegalStateException("ticketforge.contract-dir has no schema.sql: " + p);
    }
    Path cursor = Paths.get("").toAbsolutePath().normalize();
    for (int i = 0; i < 10 && cursor != null; i++) {
      Path candidate = cursor.resolve("contract");
      if (Files.isRegularFile(candidate.resolve("schema.sql"))) {
        return candidate;
      }
      cursor = cursor.getParent();
    }
    throw new IllegalStateException(
        "Could not locate contract/schema.sql by walking up from "
            + Paths.get("").toAbsolutePath()
            + " — set CONTRACT_DIR");
  }

  public Path schemaSql() {
    return contractDir().resolve("schema.sql");
  }

  public Path seedDir() {
    return contractDir().resolve("seed");
  }
}
