import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Alpaca } from "./alpaca";
import {
  botInput,
  instrument,
  timeframes,
  strategies,
  intervals,
} from "./config";
import { control, db, exclusive } from "./db";
import { history } from "./trading";
import { backtest } from "../lib/backtest";
import { indicators } from "../lib/indicators";
import {
  analyze,
  configureModel,
  modelInput,
  publicModel,
} from "./ai-registry";
import { events } from "./events";
import { accountAnalytics } from "./analytics";
export async function createApi(
  adminToken: string | undefined,
  brokerFactory: () => Alpaca = () => new Alpaca(),
  eventConnection?: string,
) {
  const secret = z
      .string()
      .min(32)
      .max(128)
      .regex(/^[!-~]+$/)
      .parse(adminToken),
    expected = Buffer.from(`Bearer ${secret}`);
  const app = Fastify({
    logger: { level: "info", redact: ["req.headers.authorization"] },
    bodyLimit: 16384,
  });
  await app.register(rateLimit, { max: 80, timeWindow: "1 minute" });
  const authorized = (value: string) => {
    const token = Buffer.from(value);
    return token.length === expected.length && timingSafeEqual(token, expected);
  };
  await events(app, authorized, eventConnection);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (req.url === "/health" || (req.ws && req.url === "/events")) return;
    if (!authorized(req.headers.authorization ?? ""))
      return reply.code(401).send({ error: "Unauthorized" });
  });
  app.setErrorHandler((error, req, reply) => {
    const status =
      error instanceof z.ZodError
        ? 400
        : ((error as { statusCode?: number }).statusCode ?? 503);
    req.log.warn(
      { status, kind: error instanceof Error ? error.name : "unknown" },
      "Request failed",
    );
    reply.code(status).send({
      error:
        status === 400
          ? "Invalid request"
          : status === 429
            ? "Rate limit exceeded"
            : "Service unavailable",
    });
  });
  app.get("/health", () => ({ ok: true, mode: "paper" }));
  app.get("/ready", async () => {
    await db.$queryRaw`SELECT 1`;
    await brokerFactory().account();
    return { ok: true };
  });
  app.get("/overview", async () => {
    const [state, bots, intents, signals, equity, heartbeat, audit] =
      await Promise.all([
        control(),
        db.bot.findMany({ orderBy: { createdAt: "desc" } }),
        db.intent.findMany({ take: 100, orderBy: { createdAt: "desc" } }),
        db.signal.findMany({ take: 50, orderBy: { createdAt: "desc" } }),
        db.equitySnapshot.findMany({ take: 500, orderBy: { time: "desc" } }),
        db.heartbeat.findUnique({ where: { id: "trading" } }),
        db.audit.findMany({ take: 40, orderBy: { time: "desc" } }),
      ]);
    const broker = await (async () => {
      try {
        const api = brokerFactory();
        const [account, positions] = await Promise.all([
          api.account(),
          api.positions(),
        ]);
        return { account, positions };
      } catch {
        return null;
      }
    })();
    return {
      mode: "paper",
      state,
      bots,
      intents,
      signals,
      equity,
      heartbeat,
      audit,
      broker,
    };
  });
  app.get("/analytics", async () => accountAnalytics(brokerFactory()));
  app.get("/assets", async (req) => {
    const { assetClass, q } = z
      .object({
        assetClass: z.enum(["us_equity", "crypto"]),
        q: z.string().max(20).default(""),
      })
      .parse(req.query);
    return (await brokerFactory().assets(assetClass))
      .filter((a) => a.tradable && a.symbol.includes(q.toUpperCase()))
      .slice(0, 100);
  });
  const chartInput = instrument.and(
    z.object({ timeframe: z.enum(timeframes) }),
  );
  app.get("/bars", async (req) => {
    const input = chartInput.parse(req.query);
    const broker = brokerFactory();
    const bars = await history(
      broker,
      input.symbol,
      input.assetClass,
      input.timeframe,
    );
    return {
      bars,
      source: broker.source(input.assetClass),
      indicators: indicators(bars),
    };
  });
  app.get("/market-sample", async (req) => {
    const input = instrument.parse(req.query);
    const source =
      input.assetClass === "crypto"
        ? "alpaca-crypto-us-stream"
        : "alpaca-iex-stream";
    return db.marketEvent.findMany({
      where: {
        symbol: input.symbol,
        source,
        observedAt: { gte: new Date(Date.now() - 30000) },
      },
    });
  });
  app.post("/bots", async (req) => {
    const input = botInput.parse(req.body);
    return exclusive(async (tx) => {
      if ((await tx.bot.count()) >= 20) throw new Error("Bot limit");
      const bot = await tx.bot.create({ data: input });
      await tx.audit.create({
        data: { event: "bot.created", detail: { id: bot.id, ...input } },
      });
      return bot;
    });
  });
  app.patch("/bots/:id", async (req) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    return exclusive(async (tx) => {
      const bot = await tx.bot.update({ where: { id }, data: { enabled } });
      await tx.audit.create({
        data: { event: "bot.changed", detail: { id, enabled } },
      });
      return bot;
    });
  });
  app.post("/control", async (req) => {
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("stop") }),
        z.object({
          action: z.literal("resume"),
          confirmation: z.literal("RESUME PAPER TRADING"),
        }),
      ])
      .parse(req.body);
    if (input.action === "resume") {
      const account = await brokerFactory().account();
      if (
        account.status !== "ACTIVE" ||
        account.trading_blocked ||
        account.account_blocked
      )
        throw new Error("Account unavailable");
    }
    return exclusive(async (tx) => {
      const stopped = input.action === "stop",
        reason = stopped ? "Operator stop" : "Operator confirmed paper trading";
      const state = await tx.control.upsert({
        where: { id: 1 },
        create: { id: 1, stopped, reason },
        update: { stopped, reason },
      });
      await tx.audit.create({
        data: { event: `control.${input.action}`, detail: { reason } },
      });
      return state;
    });
  });
  app.post("/backtest", async (req) => {
    const input = chartInput
      .and(
        z.object({
          strategy: z.enum(strategies),
          start: z.string().date(),
          end: z.string().date(),
          capital: z.number().positive().max(1e8),
          costBps: z.number().min(0).max(500).default(15),
        }),
      )
      .parse(req.body);
    const start = new Date(input.start),
      end = new Date(input.end);
    if (+end <= +start || +end > Date.now() || +end - +start > 366 * 86400000)
      throw new z.ZodError([]);
    const api = brokerFactory();
    const bars = (
      await api.bars(
        input.symbol,
        input.assetClass,
        input.timeframe,
        start,
        end,
      )
    ).filter(
      (b) =>
        Date.parse(b.t) >= +start &&
        Date.parse(b.t) +
          intervals[timeframes.indexOf(input.timeframe)] * 1000 <=
          +end,
    );
    if (bars.length < 202 || bars.length > 50000) throw new z.ZodError([]);
    const result = backtest(bars, input.strategy, input.capital, input.costBps),
      source = api.source(input.assetClass);
    const saved = await db.backtestRun.create({
      data: { config: input, result, source, version: result.version },
    });
    return { id: saved.id, ...result, config: input, source };
  });
  app.get("/backtest/:id", async (req) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
    return db.backtestRun.findUniqueOrThrow({ where: { id } });
  });
  app.get("/ai-models", async () => {
    const [models, usage] = await Promise.all([
      db.aIModel.findMany({ select: publicModel }),
      db.aIUsage.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    ]);
    return { models, usage };
  });
  app.post("/ai-models", async (req) =>
    configureModel(modelInput.parse(req.body)),
  );
  app.post(
    "/analysis",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async (req) => {
      const { id } = z.object({ id: z.string().cuid() }).parse(req.body);
      const signal = await db.signal.findUniqueOrThrow({
        where: { id },
        include: { bot: true },
      });
      const cached = await db.audit.findFirst({
        where: {
          event: "ai.analysis",
          detail: { path: ["signalId"], equals: id },
          time: { gte: new Date(Date.now() - 3600000) },
        },
        orderBy: { time: "desc" },
      });
      if (cached) return cached.detail;
      const result = await analyze({
        symbol: signal.bot.symbol,
        timeframe: signal.bot.timeframe,
        candle: signal.candle,
        technical: signal.readings,
      });
      await db.audit.create({
        data: { event: "ai.analysis", detail: { signalId: id, ...result } },
      });
      return result;
    },
  );
  return app;
}
