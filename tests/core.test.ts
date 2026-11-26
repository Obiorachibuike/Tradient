import { describe, expect, it, vi } from "vitest";
import { ema, indicators, evaluate } from "../lib/indicators";
import { floor, lossLimit, sizeEntry } from "../lib/risk";
import { backtest } from "../lib/backtest";
import { Alpaca } from "../server/alpaca";
import { credentials } from "../server/config";
import { analysisSchema } from "../server/ai";
import { candles, env } from "./fixtures";
const size = {
  equity: "10000",
  cash: "10000",
  buyingPower: "10000",
  ask: 10.01,
  bid: 10,
  displayed: 1000,
  atr: 0.2,
  qtyStep: ".001",
  priceStep: ".01",
  minimum: ".001",
};
describe("trading core", () => {
  it("calculates seeded EMA, flat RSI, ATR and ADX independently", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
    const flat = candles().map((b) => ({
      ...b,
      o: 10,
      h: 10,
      l: 10,
      c: 10,
      v: 1,
    }));
    expect(indicators(flat)).toMatchObject({
      e200: 10,
      rsi: 50,
      atr: 0,
      adx: 0,
      vwap: 10,
      histogram: 0,
    });
    expect(indicators(flat.slice(0, 199))).toBeNull();
  });
  it("scores a deterministic entry without representing it as AI confidence", () => {
    expect(evaluate(candles(), "ema")).toMatchObject({
      entry: true,
      score: 85,
      components: {
        ai: 0,
        trend: 25,
        momentum: 20,
        volume: 15,
        volatility: 10,
        regime: 15,
      },
    });
  });
  it("caps with decimal arithmetic and rejects poor quotes and lot sizes", () => {
    expect(floor("0.3", "0.1").toFixed()).toBe("0.3");
    expect(sizeEntry(size)).toEqual({
      quantity: "99.9",
      limitPrice: "10.01",
      stop: "9.61",
      target: "10.81",
    });
    expect(sizeEntry({ ...size, bid: 9 })).toBeNull();
    expect(sizeEntry({ ...size, bid: 10.02 })).toBeNull();
    expect(sizeEntry({ ...size, minimum: "100" })).toBeNull();
    expect(sizeEntry({ ...size, displayed: 20 })?.quantity).toBe("2");
    expect(lossLimit("9800", "10000", ".02")).toBe(true);
    expect(lossLimit("9800.01", "10000", ".02")).toBe(false);
  });
  it("enters at the next open and prioritizes the stop if both levels are touched", () => {
    const bs = candles();
    const t = Date.parse(bs.at(-1)!.t);
    bs.push(
      {
        t: new Date(t + 60000).toISOString(),
        o: 140,
        c: 140,
        h: 160,
        l: 120,
        v: 1000,
      },
      {
        t: new Date(t + 120000).toISOString(),
        o: 140,
        c: 140,
        h: 140,
        l: 140,
        v: 1000,
      },
    );
    const out = backtest(bs, "ema", 10000, 20);
    expect(out.trades).toHaveLength(1);
    expect(out.trades[0]).toMatchObject({
      entryTime: bs[202].t,
      reason: "stop",
      entry: 140.28,
    });
    expect(out.netReturn).toBeLessThan(0);
  });
  it("rejects malformed or out-of-range AI analysis", () => {
    const value = {
      marketRegime: "bullish",
      recommendation: "hold",
      confidence: 0.7,
      reasoning: [],
      risks: [],
      invalidationConditions: [],
    };
    expect(analysisSchema.safeParse(value).success).toBe(true);
    expect(analysisSchema.safeParse({ ...value, confidence: 75 }).success).toBe(
      false,
    );
    expect(analysisSchema.safeParse({ ...value, execute: "buy" }).success).toBe(
      false,
    );
  });
});
describe("Alpaca client contract (mock transport)", () => {
  it("fails closed for live flags, lookalike origins, and missing credentials", () => {
    expect(() => credentials({ ...env, ALPACA_LIVE_TRADE: "true" })).toThrow();
    expect(() =>
      credentials({
        ...env,
        ALPACA_TRADING_BASE_URL: "https://api.alpaca.markets",
      }),
    ).toThrow();
    expect(() => credentials({ ...env, ALPACA_API_KEY: "" })).toThrow();
  });
  it("uses authenticated, non-redirecting paper-only order calls with asset-specific TIF", async () => {
    const calls: unknown[][] = [];
    const adapter = new Alpaca(
      vi.fn(async (url, opts) => {
        calls.push([url, opts]);
        return Response.json({
          id: "broker-id",
          client_order_id: "test-id",
          symbol: "BTC/USD",
          side: "buy",
          status: "accepted",
          filled_qty: "0",
        });
      }),
      env,
    );
    await expect(
      adapter.submit({
        id: "test-id",
        symbol: "BTC/USD",
        assetClass: "crypto",
        side: "buy",
        quantity: ".01",
        limitPrice: "100",
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    const [url, o] = calls[0] as [string, RequestInit];
    expect(url).toBe("https://paper-api.alpaca.markets/v2/orders");
    expect(o.redirect).toBe("error");
    expect(JSON.parse(String(o.body))).toMatchObject({
      client_order_id: "test-id",
      time_in_force: "ioc",
      type: "limit",
      qty: ".01",
    });
  });
  it("paginates data, deduplicates timestamps, and rejects malformed bars", async () => {
    const b = candles()[0],
      next = { ...b, t: new Date(Date.parse(b.t) + 60000).toISOString() };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ bars: { SPY: [b] }, next_page_token: "other" }),
      )
      .mockResolvedValueOnce(
        Response.json({ bars: { SPY: [b, next] }, next_page_token: null }),
      )
      .mockResolvedValueOnce(
        Response.json({ bars: { SPY: [{ ...b, h: 0 }] } }),
      );
    const adapter = new Alpaca(fetcher, env);
    const get = () =>
      adapter.bars("SPY", "us_equity", "1Min", new Date(0), new Date());
    await expect(get()).resolves.toEqual([b, next]);
    expect(String(fetcher.mock.calls[1][0])).toContain("page_token=other");
    await expect(get()).rejects.toThrow();
  });
});
