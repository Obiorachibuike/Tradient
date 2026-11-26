import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";
export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
export function exclusive<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(198523172) AS locked`;
      if (!rows[0]?.locked) throw new Error("Trading state busy");
      return fn(tx);
    },
    { timeout: 25000 },
  );
}
export async function control() {
  return db.control.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}
