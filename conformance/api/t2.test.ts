import { describe, expect, it } from "vitest";
import { api, login } from "./helpers.js";

async function firstAvailableSeat(token: string, eventId = "event_arena_2000") {
  const { body } = await api<{ data: { id: string }[] }>(
    `/events/${eventId}/seats?availability=available&page=1&page_size=1`,
    { token }
  );
  return body.data[0]?.id;
}

describe("T2 holds", () => {
  it("create hold and block second buyer", async () => {
    const a = await login("buyer01@ticketforge.test");
    const b = await login("buyer02@ticketforge.test");
    const seatId = await firstAvailableSeat(a.token);
    expect(seatId).toBeTruthy();

    const created = await api<{ id: string; status: string; expires_at: string; created_at: string }>(
      "/holds",
      {
        method: "POST",
        token: a.token,
        body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seatId] }),
      }
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("active");
    const ttlMs =
      new Date(created.body.expires_at).getTime() - new Date(created.body.created_at).getTime();
    expect(ttlMs).toBeGreaterThanOrEqual(590_000);
    expect(ttlMs).toBeLessThanOrEqual(610_000);

    const conflict = await api<{ error: { code: string } }>("/holds", {
      method: "POST",
      token: b.token,
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seatId] }),
    });
    expect(conflict.status).toBe(409);
    expect(["SEAT_ALREADY_HELD", "SEAT_NOT_AVAILABLE"]).toContain(conflict.body.error.code);

    const release = await api(`/holds/${created.body.id}`, {
      method: "DELETE",
      token: a.token,
    });
    expect(release.status).toBe(204);

    const again = await api("/holds", {
      method: "POST",
      token: b.token,
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seatId] }),
    });
    expect(again.status).toBe(201);

    await api(`/holds/${(again.body as { id: string }).id}`, {
      method: "DELETE",
      token: b.token,
    });
  });

  it("buyer cannot release another's hold", async () => {
    const a = await login("buyer03@ticketforge.test");
    const b = await login("buyer04@ticketforge.test");
    const seatId = await firstAvailableSeat(a.token);
    const created = await api<{ id: string }>("/holds", {
      method: "POST",
      token: a.token,
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seatId] }),
    });
    expect(created.status).toBe(201);

    const denied = await api<{ error: { code: string } }>(`/holds/${created.body.id}`, {
      method: "DELETE",
      token: b.token,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("INSUFFICIENT_PERMISSION");

    await api(`/holds/${created.body.id}`, { method: "DELETE", token: a.token });
  });
});
