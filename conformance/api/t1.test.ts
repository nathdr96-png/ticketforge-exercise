import { describe, expect, it } from "vitest";
import { api, assertIntegerCents, login } from "./helpers.js";

describe("T1 health + auth + CRUD", () => {
  it("GET /health", async () => {
    const { status, body } = await api<{ status: string }>("/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("login success", async () => {
    const body = await login("buyer01@ticketforge.test");
    expect(body.token).toBeTruthy();
    expect(body.user.role).toBe("buyer");
  });

  it("login failure", async () => {
    const { status, body } = await api<{ error: { code: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "nope@x.test", password: "password123" }),
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("unauthenticated list events", async () => {
    const { status, body } = await api<{ error: { code: string } }>("/events");
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("list events paginated", async () => {
    const { token } = await login("buyer01@ticketforge.test");
    const { status, body } = await api<{
      data: unknown[];
      page: number;
      page_size: number;
      total: number;
    }>("/events?page=1&page_size=2", { token });
    expect(status).toBe(200);
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(2);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it("get arena event with 2000 seats", async () => {
    const { token } = await login("buyer01@ticketforge.test");
    const { status, body } = await api<Record<string, unknown>>("/events/event_arena_2000", {
      token,
    });
    expect(status).toBe(200);
    expect(body.seat_count).toBe(2000);
    assertIntegerCents(body, ["base_price_cents"]);
  });

  it("list seats filtered by section A", async () => {
    const { token } = await login("buyer01@ticketforge.test");
    // Section A always has 500 seats (25×20); availability may shrink as other tests run.
    const all = await api<{ total: number }>(
      "/events/event_arena_2000/seats?section=A&page=1&page_size=50",
      { token }
    );
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(500);

    const { status, body } = await api<{
      data: { section: string; status: string; price_cents: number }[];
      total: number;
    }>("/events/event_arena_2000/seats?section=A&availability=available&page=1&page_size=50", {
      token,
    });
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    for (const s of body.data) {
      expect(s.section).toBe("A");
      expect(s.status).toBe("available");
      expect(Number.isInteger(s.price_cents)).toBe(true);
    }
  });
});
