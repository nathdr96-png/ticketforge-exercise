import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://ticketforge:ticketforge@localhost:5432/ticketforge",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "ticketforge-dev-secret-change-me",
  holdTtlSeconds: Number(process.env.HOLD_TTL_SECONDS ?? 600),
  feePercent: Number(process.env.FEE_PERCENT ?? 5),
  feeFixedCents: Number(process.env.FEE_FIXED_CENTS ?? 30),
  logLevel: process.env.LOG_LEVEL ?? "info",
};

/** fee_cents = floor(subtotal_after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS */
export function computeFeeCents(subtotalAfterDiscount: number): number {
  return Math.floor((subtotalAfterDiscount * config.feePercent) / 100) + config.feeFixedCents;
}

export function computeDiscountCents(subtotal: number, percentOff: number): number {
  return Math.floor((subtotal * percentOff) / 100);
}
