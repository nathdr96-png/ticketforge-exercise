package com.ticketforge.worker;

import com.ticketforge.service.HoldExpiryService;
import com.ticketforge.service.TicketForgeService;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Background expiry: every second, active holds whose {@code expires_at} has passed are
 * expired and their seats released.
 *
 * <p>Disabled for the {@code migrate}/{@code seed} CLI tasks, which run with no web context.
 */
@Component
@ConditionalOnWebApplication
public class HoldExpiryWorker {

  private static final Logger log = LoggerFactory.getLogger(HoldExpiryWorker.class);
  private static final int BATCH = 100;

  private final TicketForgeService svc;
  private final HoldExpiryService holdExpiry;

  public HoldExpiryWorker(TicketForgeService svc, HoldExpiryService holdExpiry) {
    this.svc = svc;
    this.holdExpiry = holdExpiry;
  }

  @Scheduled(
      initialDelayString = "${ticketforge.hold-expiry-interval-ms:1000}",
      fixedDelayString = "${ticketforge.hold-expiry-interval-ms:1000}")
  public void tick() {
    try {
      List<String> expired = svc.findExpiredHoldIds(BATCH);
      for (String holdId : expired) {
        try {
          holdExpiry.expireHold(holdId);
        } catch (RuntimeException e) {
          log.warn("Could not expire hold {}: {}", holdId, e.getMessage());
        }
      }
    } catch (RuntimeException e) {
      log.error("hold expiry worker error", e);
    }
  }
}
