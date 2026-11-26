import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { interpret, providerName, withFallback } from "./ai";
import { D } from "../lib/risk";
const tokenPrice = z.string().regex(/^\d{1,5}(\.\d{1,6})?$/);
export const modelInput = z
  .object({
    provider: providerName,
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\w./:-]+$/),
    role: z.enum(["primary", "fallback", "inactive"]),
    enabled: z.boolean(),
    key: z.string().trim().min(8).max(2048).optional(),
    maxTokens: z.number().int().min(100).max(1024),
    timeoutMs: z.number().int().min(1000).max(20000),
    inputUsdPerMillion: tokenPrice,
    outputUsdPerMillion: tokenPrice,
  })
  .refine(
    (x) =>
      x.role === "inactive" ||
      (x.role === "primary" && x.provider === "agnes") ||
      (x.role === "fallback" && x.provider === "openai"),
  );
function master(secret = process.env.AI_ENCRYPTION_KEY) {
  const bytes = Buffer.from(secret ?? "", "base64");
  if (bytes.length !== 32)
    throw new Error("AI registry encryption key is not configured");
  return bytes;
}
export function seal(key: string, scope: string, secret?: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", master(secret), iv);
  cipher.setAAD(Buffer.from(scope));
  return [iv, cipher.update(key, "utf8"), cipher.final(), cipher.getAuthTag()]
    .reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))
    .toString("base64");
}
export function open(ciphertext: string, scope: string, secret?: string) {
  const bytes = Buffer.from(ciphertext, "base64"),
    decipher = createDecipheriv(
      "aes-256-gcm",
      master(secret),
      bytes.subarray(0, 12),
    );
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([
    decipher.update(bytes.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
}
export const publicModel = {
  id: true,
  provider: true,
  name: true,
  role: true,
  enabled: true,
  maxTokens: true,
  timeoutMs: true,
  inputUsdPerMillion: true,
  outputUsdPerMillion: true,
  updatedAt: true,
} as const;
export async function configureModel(input: z.infer<typeof modelInput>) {
  const { key, ...settings } = input,
    unique = { provider_name: { provider: input.provider, name: input.name } };
  const secretCipher = key ? seal(key, JSON.stringify(unique)) : undefined;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(198523174)`;
    const existing = await tx.aIModel.findUnique({ where: unique });
    if (!existing && !secretCipher) throw new z.ZodError([]);
    if (input.enabled && input.role !== "inactive")
      await tx.aIModel.updateMany({
        where: { role: input.role, NOT: unique.provider_name },
        data: { enabled: false },
      });
    const result = existing
      ? await tx.aIModel.update({
          where: unique,
          data: { ...settings, secretCipher },
          select: publicModel,
        })
      : await tx.aIModel.create({
          data: { ...settings, secretCipher: secretCipher! },
          select: publicModel,
        });
    await tx.audit.create({
      data: {
        event: "ai.model.changed",
        detail: {
          id: result.id,
          provider: result.provider,
          model: result.name,
          enabled: result.enabled,
          role: result.role,
          keyRotated: !!key,
        },
      },
    });
    return result;
  });
}
function cost(
  input: number,
  output: number,
  rates: {
    inputUsdPerMillion: { toString(): string };
    outputUsdPerMillion: { toString(): string };
  },
) {
  return new D(rates.inputUsdPerMillion.toString())
    .mul(input)
    .plus(new D(rates.outputUsdPerMillion.toString()).mul(output))
    .div(1000000)
    .toDecimalPlaces(8, D.ROUND_UP)
    .toFixed();
}
export async function analyze(
  snapshot: unknown,
  transport: typeof fetch = fetch,
) {
  const rows = await db.aIModel.findMany({
    where: { enabled: true, role: { in: ["primary", "fallback"] } },
  });
  const ordered = [
    rows.find((m) => m.role === "primary" && m.provider === "agnes"),
    rows.find((m) => m.role === "fallback" && m.provider === "openai"),
  ].filter((m) => m !== undefined);
  return withFallback(ordered, async (m) => {
    const key = open(
        m.secretCipher,
        JSON.stringify({
          provider_name: { provider: m.provider, name: m.name },
        }),
      ),
      provider = providerName.parse(m.provider);
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const limits = z
      .object({
        requests: z.coerce.number().int().min(1).max(40),
        usd: tokenPrice.refine((v) => new D(v).gt(0) && new D(v).lte(10)),
      })
      .parse({
        requests: process.env.AI_DAILY_REQUESTS ?? "20",
        usd: process.env.AI_DAILY_USD ?? "2",
      });
    const reserve = cost(16384, m.maxTokens, m);
    const usage = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(198523175)`;
      const summary = await tx.aIUsage.aggregate({
        where: { createdAt: { gte: day } },
        _count: true,
        _sum: { estimatedUsd: true },
      });
      if (
        summary._count >= limits.requests ||
        new D(summary._sum.estimatedUsd?.toString() ?? 0)
          .plus(reserve)
          .gt(limits.usd)
      )
        throw new Error("Daily AI budget unavailable");
      return tx.aIUsage.create({
        data: {
          provider,
          model: m.name,
          status: "reserved",
          estimatedUsd: reserve,
        },
      });
    });
    try {
      const result = await interpret(
        { ...m, provider, key },
        snapshot,
        transport,
      );
      const u = result.usage;
      await db.aIUsage.update({
        where: { id: usage.id },
        data: {
          status: "succeeded",
          ...(u
            ? {
                inputTokens: u.prompt_tokens,
                outputTokens: u.completion_tokens,
                estimatedUsd: cost(u.prompt_tokens, u.completion_tokens, m),
              }
            : {}),
        },
      });
      return result;
    } catch (e) {
      await db.aIUsage.update({
        where: { id: usage.id },
        data: { status: "failed" },
      });
      throw e;
    }
  });
}
