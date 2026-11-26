import { z } from "zod";
import { credentials, paperTrading, marketData } from "./config";
const amount = z.string().regex(/^-?\d+(\.\d+)?$/);
const time = z.string().datetime({ offset: true });
export const accountSchema = z.object({
  id: z.string(),
  status: z.string(),
  equity: amount,
  last_equity: amount,
  buying_power: amount,
  cash: amount,
  trading_blocked: z.boolean(),
  account_blocked: z.boolean(),
  crypto_status: z.string().nullish(),
});
export const assetSchema = z.object({
  symbol: z.string(),
  class: z.string(),
  status: z.string(),
  tradable: z.boolean(),
  min_order_size: amount.nullish(),
  min_trade_increment: amount.nullish(),
  price_increment: amount.nullish(),
});
export const orderSchema = z.object({
  id: z.string(),
  client_order_id: z.string(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  status: z.string(),
  filled_qty: amount,
  filled_avg_price: amount.nullish(),
});
export const positionSchema = z.object({
  symbol: z.string(),
  qty: amount,
  qty_available: amount.nullish(),
  avg_entry_price: amount,
  market_value: amount,
  unrealized_pl: amount,
  asset_class: z.string(),
});
export const barSchema = z
  .object({
    t: time,
    o: z.number().positive().finite(),
    h: z.number().positive().finite(),
    l: z.number().positive().finite(),
    c: z.number().positive().finite(),
    v: z.number().nonnegative().finite(),
  })
  .refine((b) => b.h >= Math.max(b.o, b.c, b.l) && b.l <= Math.min(b.o, b.c));
export type Bar = z.infer<typeof barSchema>;
export type AssetClass = "crypto" | "us_equity";
export class BrokerError extends Error {
  constructor(readonly status: number) {
    super(`Alpaca HTTP ${status}`);
  }
}
export class Alpaca {
  private readonly auth: ReturnType<typeof credentials>;
  constructor(
    private readonly transport: typeof fetch = fetch,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.auth = credentials(env);
  }
  private async request<T>(
    schema: z.ZodType<T>,
    base: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const res = await this.transport(base + path, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "APCA-API-KEY-ID": this.auth.ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": this.auth.ALPACA_SECRET_KEY,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new BrokerError(res.status);
    return schema.parse(res.status === 204 ? null : await res.json());
  }
  account() {
    return this.request(accountSchema, paperTrading, "/v2/account");
  }
  assets(cls: AssetClass) {
    return this.request(
      z.array(assetSchema),
      paperTrading,
      `/v2/assets?status=active&asset_class=${cls}`,
    );
  }
  asset(symbol: string) {
    return this.request(
      assetSchema,
      paperTrading,
      `/v2/assets/${encodeURIComponent(symbol)}`,
    );
  }
  clock() {
    return this.request(
      z.object({ is_open: z.boolean(), next_close: time, timestamp: time }),
      paperTrading,
      "/v2/clock",
    );
  }
  positions() {
    return this.request(z.array(positionSchema), paperTrading, "/v2/positions");
  }
  openOrders() {
    return this.request(
      z.array(orderSchema),
      paperTrading,
      "/v2/orders?status=open&limit=500",
    );
  }
  order(id: string) {
    return this.request(
      orderSchema,
      paperTrading,
      `/v2/orders:by_client_order_id?${new URLSearchParams({ client_order_id: id })}`,
    );
  }
  cancel(id: string) {
    return this.request(
      z.null(),
      paperTrading,
      `/v2/orders/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
  submit(o: {
    id: string;
    symbol: string;
    assetClass: AssetClass;
    side: "buy" | "sell";
    quantity: string;
    limitPrice: string;
  }) {
    return this.request(orderSchema, paperTrading, "/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        client_order_id: o.id,
        symbol: o.symbol,
        qty: o.quantity,
        limit_price: o.limitPrice,
        side: o.side,
        type: "limit",
        time_in_force: o.assetClass === "crypto" ? "ioc" : "day",
      }),
    });
  }
  private dataPath(cls: AssetClass, sub: string) {
    return cls === "crypto" ? `/v1beta3/crypto/us/${sub}` : `/v2/stocks/${sub}`;
  }
  source(cls: AssetClass) {
    return cls === "crypto" ? "alpaca-crypto-us" : "alpaca-iex";
  }
  async quote(symbol: string, cls: AssetClass) {
    const q = new URLSearchParams({
      symbols: symbol,
      ...(cls === "us_equity" ? { feed: "iex" } : {}),
    });
    const data = await this.request(
      z.object({
        quotes: z.record(
          z.object({
            t: time,
            bp: z.number().finite().positive(),
            ap: z.number().finite().positive(),
            bs: z.number().finite().nonnegative(),
            as: z.number().finite().nonnegative(),
          }),
        ),
      }),
      marketData,
      `${this.dataPath(cls, "quotes/latest")}?${q}`,
    );
    if (!data.quotes[symbol]) throw new Error("Quote unavailable");
    return data.quotes[symbol];
  }
  async bars(
    symbol: string,
    cls: AssetClass,
    timeframe: string,
    start: Date,
    end: Date,
  ) {
    const q = new URLSearchParams({
      symbols: symbol,
      timeframe,
      start: start.toISOString(),
      end: end.toISOString(),
      limit: "10000",
      ...(cls === "us_equity" ? { feed: "iex", adjustment: "raw" } : {}),
    });
    const bars = new Map<string, Bar>();
    const tokens = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const result = await this.request(
        z.object({
          bars: z.record(z.array(barSchema)).nullable(),
          next_page_token: z.string().nullish(),
        }),
        marketData,
        `${this.dataPath(cls, "bars")}?${q}`,
      );
      for (const b of result.bars?.[symbol] ?? [])
        bars.set(new Date(b.t).toISOString(), b);
      if (!result.next_page_token)
        return [...bars.values()].sort(
          (a, b) => Date.parse(a.t) - Date.parse(b.t),
        );
      if (tokens.has(result.next_page_token)) break;
      tokens.add(result.next_page_token);
      q.set("page_token", result.next_page_token);
    }
    throw new Error("Bar pagination incomplete");
  }
}
