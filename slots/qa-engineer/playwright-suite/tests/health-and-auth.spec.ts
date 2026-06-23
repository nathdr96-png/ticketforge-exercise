import { describe, expect, it } from "vitest";
import { api, expectError, login } from "./helpers.js";

const BUYER = "buyer01@ticketforge.test";

describe("service liveness", () => {
  it("reports itself healthy", async () => {
    const res = await api<{ status: string }>("/health");
    expect(res.status, `GET /health should be 200, got ${res.status}`).toBe(200);
    expect(res.body.status, `GET /health should report status "ok"`).toBe("ok");
  });
});

describe("authentication", () => {
  it("issues a token and identifies the caller's role", async () => {
    const body = await login(BUYER);
    expect(typeof body.token, "login must return a bearer token string").toBe("string");
    expect(body.token.length, "the bearer token must not be empty").toBeGreaterThan(0);
    expect(body.user.email, "login must echo back the authenticated user").toBe(BUYER);
    expect(body.user.role, `${BUYER} is seeded as a buyer`).toBe("buyer");
  });

  it("refuses a wrong password without revealing whether the account exists", async () => {
    const wrongPassword = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: BUYER, password: "not-the-password" }),
    });
    expectError(wrongPassword, 401, "UNAUTHENTICATED", "login with a wrong password");

    const unknownUser = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@ticketforge.test", password: "password123" }),
    });
    expectError(unknownUser, 401, "UNAUTHENTICATED", "login as an unknown user");
    expect(
      (unknownUser.body as { error: { message: string } }).error.message,
      "the failure message must not disclose whether the account exists"
    ).toBe((wrongPassword.body as { error: { message: string } }).error.message);
  });

  it("rejects a malformed login body as a validation error, not a 500", async () => {
    const res = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: BUYER }) });
    expectError(res, 400, "VALIDATION_ERROR", "login with no password");
  });
});

describe("authorization gate", () => {
  it("requires a bearer token on every protected route", async () => {
    for (const path of [
      "/events",
      "/events/event_arena_2000",
      "/events/event_arena_2000/seats",
      "/reports/revenue",
    ]) {
      expectError(await api(path), 401, "UNAUTHENTICATED", `GET ${path} with no token`);
    }
  });

  it("rejects a token it did not issue", async () => {
    const res = await api("/events", { token: "not.a.real.token" });
    expectError(res, 401, "UNAUTHENTICATED", "GET /events with a forged token");
  });

  it("keeps the revenue report away from buyers", async () => {
    const token = (await login(BUYER)).token;
    const res = await api("/reports/revenue", { token });
    expectError(res, 403, "INSUFFICIENT_PERMISSION", "a buyer reading the revenue report");
  });
});
