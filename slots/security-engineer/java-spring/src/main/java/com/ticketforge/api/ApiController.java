package com.ticketforge.api;

import com.ticketforge.error.AppException;
import com.ticketforge.error.ErrorCode;
import com.ticketforge.security.AuthUser;
import com.ticketforge.service.AuthService;
import com.ticketforge.service.TicketForgeService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The whole REST surface from {@code contract/openapi.yaml}, route for route.
 */
@RestController
public class ApiController {

  private static final int MAX_PAGE_SIZE = 200;
  private static final int DEFAULT_PAGE_SIZE = 50;

  private final AuthService authService;
  private final TicketForgeService svc;

  public ApiController(AuthService authService, TicketForgeService svc) {
    this.authService = authService;
    this.svc = svc;
  }

  // ------------------------------------------------------------ public

  @GetMapping("/health")
  public Map<String, String> health() {
    return Map.of("status", "ok");
  }

  @GetMapping("/")
  public Map<String, String> root() {
    Map<String, String> body = new LinkedHashMap<>();
    body.put("name", "TicketForge API");
    body.put("status", "ok");
    body.put("health", "/health");
    body.put("docs", "See contract/openapi.yaml");
    body.put("login", "POST /auth/login");
    body.put("stack", "Java 21 + Spring Boot 3 + JdbcTemplate");
    return body;
  }

  @PostMapping("/auth/login")
  public Dtos.LoginResponse login(@RequestBody(required = false) Dtos.LoginRequest body) {
    if (body == null
        || body.email() == null
        || body.email().isBlank()
        || body.password() == null
        || body.password().isBlank()) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, "email and password required");
    }
    return authService.login(body.email(), body.password());
  }

  // ------------------------------------------------------------ events

  @GetMapping("/events")
  public Dtos.PageDto<Dtos.EventDto> listEvents(
      @RequestParam(required = false) String page,
      @RequestParam(name = "page_size", required = false) String pageSize,
      @RequestParam(required = false) String status) {
    return svc.listEvents(parsePage(page), parsePageSize(pageSize), status);
  }

  @GetMapping("/events/{eventId}")
  public Dtos.EventDto getEvent(@PathVariable String eventId) {
    return svc.getEvent(eventId);
  }

  @GetMapping("/events/{eventId}/seats")
  public Dtos.PageDto<Dtos.SeatDto> listSeats(
      @PathVariable String eventId,
      @RequestParam(required = false) String page,
      @RequestParam(name = "page_size", required = false) String pageSize,
      @RequestParam(required = false) String section,
      @RequestParam(required = false) String availability) {
    return svc.listSeats(
        eventId, parsePage(page), parsePageSize(pageSize), section, availability);
  }

  // ------------------------------------------------------------- holds

  @PostMapping("/holds")
  public ResponseEntity<Dtos.HoldDto> createHold(
      @RequestBody(required = false) Dtos.CreateHoldRequest body) {
    if (body == null || body.event_id() == null || body.event_id().isBlank()
        || body.seat_ids() == null) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, "event_id and seat_ids required");
    }
    Dtos.HoldDto hold = svc.createHold(currentUser(), body.event_id(), body.seat_ids());
    return ResponseEntity.status(HttpStatus.CREATED).body(hold);
  }

  @GetMapping("/holds/{holdId}")
  public Dtos.HoldDto getHold(@PathVariable String holdId) {
    return svc.getHold(currentUser(), holdId);
  }

  @DeleteMapping("/holds/{holdId}")
  public ResponseEntity<Void> releaseHold(@PathVariable String holdId) {
    svc.releaseHold(currentUser(), holdId);
    return ResponseEntity.noContent().build();
  }

  // ------------------------------------------------------------ orders

  @PostMapping("/orders")
  public ResponseEntity<Dtos.OrderDto> createOrder(
      @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestBody(required = false) Dtos.CreateOrderRequest body) {
    TicketForgeService.OrderResult result = svc.createOrder(currentUser(), idempotencyKey, body);
    // A replay of an identical request answers 200; a fresh order answers 201.
    return ResponseEntity.status(result.replay() ? HttpStatus.OK : HttpStatus.CREATED)
        .body(result.order());
  }

  @GetMapping("/orders/{orderId}")
  public Dtos.OrderDto getOrder(@PathVariable String orderId) {
    return svc.getOrder(currentUser(), orderId);
  }

  // ----------------------------------------------------------- reports

  @GetMapping("/reports/revenue")
  public Dtos.RevenueReport revenue(
      @RequestParam(name = "event_id", required = false) String eventId,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to) {
    return svc.revenueReport(currentUser(), eventId, from, to);
  }

  // ----------------------------------------------------------- helpers

  private static AuthUser currentUser() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !(auth.getPrincipal() instanceof AuthUser user)) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, "Authentication required");
    }
    return user;
  }

  /** {@code page} is 1-based; the service turns it into {@code OFFSET (page-1)*page_size}. */
  private static int parsePage(String raw) {
    return Math.max(1, parseInt(raw, 1));
  }

  private static int parsePageSize(String raw) {
    return Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(raw, DEFAULT_PAGE_SIZE)));
  }

  private static int parseInt(String raw, int fallback) {
    if (raw == null || raw.isBlank()) {
      return fallback;
    }
    try {
      return Integer.parseInt(raw.trim());
    } catch (NumberFormatException e) {
      throw AppException.of(
          ErrorCode.VALIDATION_ERROR, "Invalid integer query parameter", "value", raw);
    }
  }
}
