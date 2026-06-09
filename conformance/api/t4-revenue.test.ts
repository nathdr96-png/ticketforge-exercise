import { describe, expect, it } from "vitest";
import { api, assertIntegerCents, login } from "./helpers.js";

describe("T4 revenue + authz", () => {
  it("buyer cannot read revenue report", async () => {
    const { token } = await login("buyer01@ticketforge.test");
    const { status, body } = await api<{ error: { code: string } }>("/reports/revenue", { token });
    expect(status).toBe(403);
    expect(body.error.code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("organizer can read revenue report", async () => {
    const { token } = await login("org1@ticketforge.test");
    const { status, body } = await api<Record<string, unknown>>("/reports/revenue", { token });
    expect(status).toBe(200);
    assertIntegerCents(body, ["gross_cents", "fees_cents", "discounts_cents", "net_cents"]);
    expect(Array.isArray(body.by_event)).toBe(true);
  });
});
