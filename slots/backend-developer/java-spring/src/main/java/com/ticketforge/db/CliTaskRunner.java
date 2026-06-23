package com.ticketforge.db;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

/**
 * One-shot tasks behind a flag, so {@code make migrate} / {@code make seed} reuse the same
 * wiring as the server:
 *
 * <pre>
 *   java -jar app.jar --app.task=migrate
 *   java -jar app.jar --app.task=seed     # migrate + load fixtures
 * </pre>
 */
@Component
public class CliTaskRunner implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(CliTaskRunner.class);

  private final MigrationRunner migrationRunner;
  private final SeedLoader seedLoader;
  private final ApplicationContext context;

  public CliTaskRunner(
      MigrationRunner migrationRunner, SeedLoader seedLoader, ApplicationContext context) {
    this.migrationRunner = migrationRunner;
    this.seedLoader = seedLoader;
    this.context = context;
  }

  @Override
  public void run(ApplicationArguments args) {
    String task = resolveTask(args);
    if (task == null || task.isBlank() || "none".equals(task)) {
      return;
    }
    switch (task) {
      case "migrate" -> migrationRunner.migrate();
      case "seed" -> seedLoader.migrateAndSeed();
      case "seed-only" -> seedLoader.seed();
      default -> throw new IllegalArgumentException("Unknown --app.task=" + task);
    }
    log.info("Task '{}' complete", task);
    System.exit(org.springframework.boot.SpringApplication.exit(context, (ExitCodeGenerator) () -> 0));
  }

  private static String resolveTask(ApplicationArguments args) {
    if (args.containsOption("app.task")) {
      var values = args.getOptionValues("app.task");
      if (values != null && !values.isEmpty()) {
        return values.get(0);
      }
    }
    return System.getenv("APP_TASK");
  }
}
