import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { loadUser, login, type AuthUser, verifyToken } from "../services/auth.js";
import * as svc from "../services/ticketforge.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("UNAUTHENTICATED", "Authentication required");
  }
  const partial = verifyToken(header.slice(7));
  req.user = await loadUser(partial.id);
}

export async function registerRoutes(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send(err.toJSON());
    }
    if ((err as { validation?: unknown }).validation) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: (err as Error).message },
      });
    }
    app.log.error(err);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  app.get("/", async () => ({
    name: "TicketForge API",
    status: "ok",
    health: "/health",
    docs: "See contract/openapi.yaml",
    login: "POST /auth/login",
    hint: 'curl -X POST /auth/login -H \'content-type: application/json\' -d \'{"email":"buyer01@ticketforge.test","password":"password123"}\'',
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.post<{ Body: { email: string; password: string } }>("/auth/login", async (req) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw new AppError("VALIDATION_ERROR", "email and password required");
    }
    return login(email, password);
  });

  app.get("/events", { preHandler: requireAuth }, async (req) => {
    const q = req.query as { page?: string; page_size?: string; status?: string };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.page_size ?? 50)));
    return svc.listEvents(page, pageSize, q.status);
  });

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId",
    { preHandler: requireAuth },
    async (req) => svc.getEvent(req.params.eventId)
  );

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/seats",
    { preHandler: requireAuth },
    async (req) => {
      const q = req.query as {
        page?: string;
        page_size?: string;
        section?: string;
        availability?: string;
      };
      const page = Math.max(1, Number(q.page ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(q.page_size ?? 50)));
      return svc.listSeats(req.params.eventId, page, pageSize, q.section, q.availability);
    }
  );

  app.post<{ Body: { event_id: string; seat_ids: string[] } }>(
    "/holds",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { event_id, seat_ids } = req.body ?? {};
      if (!event_id || !Array.isArray(seat_ids)) {
        throw new AppError("VALIDATION_ERROR", "event_id and seat_ids required");
      }
      const hold = await svc.createHold(req.user!, event_id, seat_ids);
      return reply.status(201).send(hold);
    }
  );

  app.get<{ Params: { holdId: string } }>(
    "/holds/:holdId",
    { preHandler: requireAuth },
    async (req) => svc.getHold(req.user!, req.params.holdId)
  );

  app.delete<{ Params: { holdId: string } }>(
    "/holds/:holdId",
    { preHandler: requireAuth },
    async (req, reply) => {
      await svc.releaseHold(req.user!, req.params.holdId);
      return reply.status(204).send();
    }
  );

  app.post<{ Body: { hold_id: string; discount_code?: string | null } }>(
    "/orders",
    { preHandler: requireAuth },
    async (req, reply) => {
      const key = req.headers["idempotency-key"];
      const idem =
        typeof key === "string" ? key : Array.isArray(key) ? key[0] : undefined;
      const { order, replay } = await svc.createOrder(req.user!, idem, req.body ?? { hold_id: "" });
      return reply.status(replay ? 200 : 201).send(order);
    }
  );

  app.get<{ Params: { orderId: string } }>(
    "/orders/:orderId",
    { preHandler: requireAuth },
    async (req) => svc.getOrder(req.user!, req.params.orderId)
  );

  app.get("/reports/revenue", { preHandler: requireAuth }, async (req) => {
    const q = req.query as { event_id?: string; from?: string; to?: string };
    return svc.revenueReport(req.user!, q);
  });
}
