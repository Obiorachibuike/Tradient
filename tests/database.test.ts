import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import PgBoss from "pg-boss";
import { Alpaca } from "../server/alpaca";
import { candles, env } from "./fixtures";
const url = process.env.TRADIENT_TEST_DATABASE_URL;
describe.skipIf(!url)(
  "PostgreSQL and paper lifecycle with mocked broker",
  () => {
    async function database() {
      // Require an explicitly designated disposable database before deleting rows.
      if (!url || !new URL(url).pathname.endsWith("_test"))
        throw new Error("Use a disposable *_test database");
      process.env.DATABASE_URL = url;
      return await import("../server/db");
    }
    beforeEach(async () => {
      const { db } = await database();
      await db.$executeRaw`TRUNCATE "Signal", "Bot", "Intent", "Control", "MarketBar", "EquitySnapshot", "Heartbeat", "Audit", "BacktestRun", "MarketEvent", "AIModel", "AIUsage"`;
    });
    afterAll(async () => {
      const { db } = await database();
      await db.$disconnect();
    });
    it("authenticates API commands and keeps bots paused until enabled", async () => {
      const { createApi } = await import("../server/http");
      const secret = "a".repeat(40),
        headers = { authorization: `Bearer ${secret}` };
      const app = await createApi(secret);
      try {
        expect(
          (await app.inject({ method: "GET", url: "/health" })).statusCode,
        ).toBe(200);
        expect(
          (await app.inject({ method: "GET", url: "/overview" })).statusCode,
        ).toBe(401);
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/control",
              headers,
              payload: { action: "resume" },
            })
          ).statusCode,
        ).toBe(400);
        const bot = await app.inject({
          method: "POST",
          url: "/bots",
          headers,
          payload: {
            symbol: "SPY",
            assetClass: "us_equity",
            timeframe: "1Min",
            strategy: "ema",
          },
        });
        expect(bot.statusCode).toBe(200);
        expect(bot.json().enabled).toBe(false);
        const stop = await app.inject({
          method: "POST",
          url: "/control",
          headers,
          payload: { action: "stop" },
        });
        expect(stop.json()).toMatchObject({ stopped: true });
      } finally {
        await app.close();
      }
    });
    it("rejects closed markets and stale quotes, reconciles partial fills, and cancels on stop", async () => {
      const { db } = await database();
      const { tick } = await import("../server/trading");
      await db.control.create({ data: { id: 1, stopped: false } });
      await db.bot.create({
        data: {
          symbol: "SPY",
          assetClass: "us_equity",
          timeframe: "1Min",
          strategy: "ema",
          enabled: true,
        },
      });
      const bars = candles(),
        last = bars.at(-1)!,
        price = Math.round(last.c * 100) / 100;
      let order:
        | {
            id: string;
            client_order_id: string;
            symbol: string;
            side: string;
            status: string;
            filled_qty: string;
            filled_avg_price: string;
          }
        | undefined;
      let posts = 0,
        cancels = 0,
        marketOpen = false,
        stale = true,
        held = false,
        exitBid: number | undefined;
      const broker = new Alpaca(
        vi.fn(async (input, init) => {
          const u = new URL(String(input));
          const now = new Date().toISOString();
          if (u.pathname === "/v2/account")
            return Response.json({
              id: "paper",
              status: "ACTIVE",
              equity: "10000",
              last_equity: "10000",
              buying_power: "10000",
              cash: "10000",
              trading_blocked: false,
              account_blocked: false,
            });
          if (u.pathname === "/v2/positions")
            return Response.json(
              held
                ? [
                    {
                      symbol: "SPY",
                      qty: "1",
                      qty_available: "1",
                      avg_entry_price: String(price),
                      market_value: String(price),
                      unrealized_pl: "0",
                      asset_class: "us_equity",
                    },
                  ]
                : [],
            );
          if (u.pathname === "/v2/clock")
            return Response.json({
              is_open: marketOpen,
              timestamp: now,
              next_close: new Date(Date.now() + 900000).toISOString(),
            });
          if (u.pathname === "/v2/assets/SPY")
            return Response.json({
              symbol: "SPY",
              class: "us_equity",
              status: "active",
              tradable: true,
            });
          if (u.pathname === "/v2/stocks/bars")
            return Response.json({ bars: { SPY: bars } });
          if (u.pathname === "/v2/stocks/quotes/latest")
            return Response.json({
              quotes: {
                SPY: {
                  ap: exitBid === undefined ? price : exitBid + 0.01,
                  bp: exitBid ?? price - 0.01,
                  t: stale ? new Date(Date.now() - 180000).toISOString() : now,
                  as: 300,
                  bs: 300,
                },
              },
            });
          if (u.pathname === "/v2/orders:by_client_order_id")
            return order
              ? Response.json(order)
              : new Response(null, { status: 404 });
          if (u.pathname === "/v2/orders" && init?.method === "POST") {
            posts++;
            const body = JSON.parse(String(init.body));
            if (body.side === "sell") {
              held = false;
              return Response.json({
                id: "alpaca-exit",
                client_order_id: body.client_order_id,
                symbol: "SPY",
                side: "sell",
                status: "filled",
                filled_qty: "1",
                filled_avg_price: String(exitBid),
              });
            }
            held = true;
            order = {
              id: "alpaca-order",
              client_order_id: body.client_order_id,
              symbol: "SPY",
              side: "buy",
              status: "partially_filled",
              filled_qty: "1",
              filled_avg_price: String(price),
            };
            throw new Error("simulated lost submission response");
          }
          if (u.pathname === "/v2/orders")
            return Response.json(
              order && order.status !== "canceled" ? [order] : [],
            );
          if (
            u.pathname === "/v2/orders/alpaca-order" &&
            init?.method === "DELETE" &&
            order
          ) {
            order.status = "canceled";
            cancels++;
            return new Response(null, { status: 204 });
          }
          throw new Error(`Unexpected fixture call: ${u.pathname}`);
        }),
        env,
      );
      await tick(broker);
      expect(posts).toBe(0);
      expect(await db.signal.count()).toBe(0);
      marketOpen = true;
      await tick(broker);
      expect(posts).toBe(0);
      expect(await db.signal.findFirst()).toMatchObject({
        decision: "risk-rejected",
      });
      await db.signal.deleteMany(); // Fresh replay of the same fixture candle.
      stale = false;
      await expect(tick(broker)).rejects.toThrow(
        "simulated lost submission response",
      );
      expect(await db.intent.findFirst()).toMatchObject({
        status: "unknown",
        brokerId: null,
      });
      await tick(broker);
      const fill = await db.intent.findFirstOrThrow();
      expect(fill.status).toBe("partially_filled");
      expect(fill.filledQuantity.toFixed()).toBe("1");
      await db.control.update({ where: { id: 1 }, data: { stopped: true } });
      await tick(broker);
      await tick(broker);
      expect(posts).toBe(1);
      expect(cancels).toBe(1);
      expect((await db.intent.findFirst())?.status).toBe("canceled");
      expect(await db.signal.count()).toBe(1);
      expect(fill.signalId).toBeTruthy();
      exitBid = Number(fill.stop?.toFixed());
      await tick(broker);
      await tick(broker);
      expect(posts).toBe(2);
      expect(
        await db.intent.findFirst({ where: { side: "sell" } }),
      ).toMatchObject({ status: "filled", parentId: fill.id });
      const { accountAnalytics } = await import("../server/analytics");
      const analytics = await accountAnalytics(broker);
      expect(Number(analytics.realizedGross)).toBeCloseTo(exitBid - price, 8);
    }, 15000);
    it("gates WebSocket state on authentication and sends real database invalidations", async () => {
      const { db } = await database();
      const { createApi } = await import("../server/http");
      const token = "z".repeat(40),
        app = await createApi(token, undefined, url);
      try {
        await app.ready();
        const invalid = await app.injectWS("/events");
        const denied = new Promise<number>((r) => invalid.on("close", r));
        invalid.send("incorrect");
        expect(await denied).toBe(1008);
        const ws = await app.injectWS("/events");
        const auth = new Promise<string>((r) =>
          ws.once("message", (msg: { toString(): string }) =>
            r(JSON.parse(msg.toString()).event),
          ),
        );
        ws.send(`Bearer ${token}`);
        expect(await auth).toBe("system.resync");
        const received = new Promise<string>((r) =>
          ws.on("message", (msg: { toString(): string }) => {
            const event = JSON.parse(msg.toString()).event;
            if (event === "bot.status.changed") r(event);
          }),
        );
        await db.bot.create({
          data: {
            symbol: "SPY",
            assetClass: "us_equity",
            timeframe: "1Min",
            strategy: "ema",
          },
        });
        expect(await received).toBe("bot.status.changed");
        ws.close();
      } finally {
        await app.close();
      }
    }, 10000);
    it("encrypts credentials, meters calls, and falls back after invalid Agnes output", async () => {
      process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
      const { db } = await database();
      const { configureModel, analyze } = await import("../server/ai-registry");
      const values = {
        enabled: true,
        key: "fake-secret-key",
        maxTokens: 300,
        timeoutMs: 7000,
        inputUsdPerMillion: "1",
        outputUsdPerMillion: "3",
      };
      expect(
        await configureModel({
          ...values,
          provider: "agnes",
          name: "agnes-2.5-flash",
          role: "primary",
        }),
      ).not.toHaveProperty("secretCipher");
      await configureModel({
        ...values,
        provider: "openai",
        name: "mock-openai-model",
        role: "fallback",
      });
      expect((await db.aIModel.findFirstOrThrow()).secretCipher).not.toContain(
        values.key,
      );
      const content = JSON.stringify({
        marketRegime: "uncertain",
        recommendation: "hold",
        confidence: 0.25,
        reasoning: [],
        risks: [],
        invalidationConditions: [],
      });
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ choices: [{ message: { content: "not JSON" } }] }),
        )
        .mockResolvedValueOnce(
          Response.json({
            choices: [{ message: { content } }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 24,
              total_tokens: 36,
            },
          }),
        );
      const result = await analyze({ signal: "test" }, transport);
      expect(result).toMatchObject({
        provider: "openai",
        analysis: { recommendation: "hold" },
      });
      expect(String(transport.mock.calls[0][0])).toBe(
        "https://apihub.agnes-ai.com/v1/chat/completions",
      );
      expect(
        JSON.parse(String(transport.mock.calls[0][1]?.body)),
      ).toHaveProperty("max_tokens", 300);
      expect(
        JSON.parse(String(transport.mock.calls[1][1]?.body)),
      ).toHaveProperty("response_format", { type: "json_object" });
      expect((await db.aIUsage.findMany()).map((x) => x.status).sort()).toEqual(
        ["failed", "succeeded"],
      );
    });
    it("runs a real pg-boss job and verifies a failed transaction rolls back", async () => {
      const { db, exclusive } = await database();
      await expect(
        exclusive(async (tx) => {
          await tx.control.create({ data: { id: 1 } });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await db.control.count()).toBe(0);
      const boss = new PgBoss({
        connectionString: url!,
        schema: "tradient_test_boss",
      });
      await boss.start();
      try {
        const name = `test-${Date.now()}`;
        await boss.createQueue(name);
        const received = new Promise<string>((resolve, reject) => {
          void boss
            .work(name, { pollingIntervalSeconds: 0.5 }, async (jobs) =>
              resolve(jobs[0].id),
            )
            .catch(reject);
        });
        const id = await boss.send(name, {});
        expect(await received).toBe(id);
      } finally {
        await boss.stop();
      }
    }, 15000);
  },
);
