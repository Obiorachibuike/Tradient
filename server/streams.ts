import { Alpaca as Sdk } from "@alpacahq/alpaca-trade-api";
import { credentials, instrument } from "./config";
import { barSchema } from "./alpaca";
import { db } from "./db";
import type { Prisma } from "../generated/prisma/client";

export function startStreams(wake: () => void) {
  const env = credentials();
  const sdk = new Sdk({
    keyId: env.ALPACA_API_KEY,
    secret: env.ALPACA_SECRET_KEY,
    paper: true,
    sandbox: false,
  });
  const orders = sdk.trading.stream({
    url: "wss://paper-api.alpaca.markets/stream",
  });
  const stocks = sdk.marketData.stockStream({ feed: "iex" });
  const crypto = sdk.marketData.cryptoStream({ loc: "us" });
  const sets = { stocks: new Set<string>(), crypto: new Set<string>() };
  const pending = new Map<string, Prisma.MarketEventCreateManyInput>();
  const bars = new Map<string, Prisma.MarketBarCreateManyInput>();
  let closed = false,
    flushing = false,
    subscribing = false;
  const report = (stream: string) =>
    console.warn(JSON.stringify({ event: "alpaca.stream.degraded", stream }));
  for (const [name, stream, source] of [
    ["stocks", stocks, "alpaca-iex-stream"],
    ["crypto", crypto, "alpaca-crypto-us-stream"],
  ] as const) {
    const tracked = sets[name];
    const receive = (
      symbol: string,
      kind: string,
      observedAt: Date,
      payload: Prisma.InputJsonObject,
    ) => {
      const age = Date.now() - +observedAt;
      if (
        !tracked.has(symbol) ||
        !Number.isFinite(age) ||
        age < -1000 ||
        age > 30000
      )
        return;
      const key = `${symbol}:${kind}`,
        current = pending.get(key);
      if (!current || +new Date(current.observedAt) < +observedAt)
        pending.set(key, { symbol, source, kind, observedAt, payload });
    };
    stream.onQuote((q) => {
      if (
        ![q.bidPrice, q.askPrice, q.bidSize, q.askSize].every(
          (x) => typeof x === "number" && Number.isFinite(x) && x >= 0,
        ) ||
        !q.bidPrice ||
        !q.askPrice ||
        q.askPrice < q.bidPrice
      )
        return;
      receive(q.symbol, "quote", q.timestamp, {
        bid: q.bidPrice,
        ask: q.askPrice,
        bidSize: q.bidSize!,
        askSize: q.askSize!,
        sourceTimestamp: q.timestampRaw ?? q.timestamp.toISOString(),
      });
    });
    stream.onTrade((t) => {
      if (
        !Number.isFinite(t.price) ||
        !Number.isFinite(t.size) ||
        t.price <= 0 ||
        t.size <= 0
      )
        return;
      receive(t.symbol, "trade", t.timestamp, {
        price: t.price,
        size: t.size,
        id: t.idRaw ?? String(t.id),
        sourceTimestamp: t.timestampRaw ?? t.timestamp.toISOString(),
      });
    });
    stream.onBar((b) => {
      const age = Date.now() - +b.timestamp;
      if (
        !tracked.has(b.symbol) ||
        !Number.isFinite(age) ||
        age < 59500 ||
        age > 180000
      )
        return;
      const result = barSchema.safeParse({
        t: b.timestamp.toISOString(),
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume,
      });
      if (result.success)
        bars.set(`${b.symbol}:${+b.timestamp}`, {
          symbol: b.symbol,
          source,
          timeframe: "1Min",
          time: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        });
    });
    stream.onError(() => report(name));
  }
  orders.onTradeUpdate(() => wake());
  orders.onError(() => report("trade_updates"));
  orders.subscribeTradeUpdates();
  orders.connect();
  function change(name: keyof typeof sets, symbols: string[]) {
    const stream = name === "stocks" ? stocks : crypto,
      tracked = sets[name],
      next = new Set(symbols);
    const removed = [...tracked].filter((s) => !next.has(s)),
      added = [...next].filter((s) => !tracked.has(s));
    if (removed.length) {
      stream.unsubscribeFromBars(removed);
      stream.unsubscribeFromQuotes(removed);
      stream.unsubscribeFromTrades(removed);
    }
    if (added.length) {
      stream.subscribeForBars(added);
      stream.subscribeForQuotes(added);
      stream.subscribeForTrades(added);
    }
    const shouldConnect = !tracked.size && next.size > 0,
      shouldDisconnect = tracked.size > 0 && !next.size;
    tracked.clear();
    next.forEach((s) => tracked.add(s));
    if (shouldConnect) stream.connect();
    if (shouldDisconnect) stream.disconnect();
  }
  async function subscribe() {
    if (closed || subscribing) return;
    subscribing = true;
    try {
      const bots = await db.bot.findMany({
        where: { enabled: true },
        select: { symbol: true, assetClass: true },
        take: 20,
      });
      if (closed) return;
      const valid = bots.filter((b) => instrument.safeParse(b).success);
      change(
        "stocks",
        valid.filter((b) => b.assetClass === "us_equity").map((b) => b.symbol),
      );
      change(
        "crypto",
        valid.filter((b) => b.assetClass === "crypto").map((b) => b.symbol),
      );
    } catch {
      report("subscriptions");
    } finally {
      subscribing = false;
    }
  }
  async function flush() {
    if (closed || flushing) return;
    flushing = true;
    const samples = [...pending.values()],
      candleBatch = [...bars.values()];
    pending.clear();
    bars.clear();
    try {
      if (candleBatch.length)
        await db.marketBar.createMany({
          data: candleBatch,
          skipDuplicates: true,
        });
      for (const s of samples) {
        // Latest-state persistence is monotonic even when more than one worker streams.
        await db.$executeRaw`INSERT INTO "MarketEvent" (symbol,source,kind,"observedAt",payload)
          VALUES (${s.symbol},${s.source},${s.kind},${new Date(s.observedAt)},${JSON.stringify(s.payload)}::jsonb)
          ON CONFLICT (symbol,source,kind) DO UPDATE SET "observedAt"=EXCLUDED."observedAt",payload=EXCLUDED.payload
          WHERE "MarketEvent"."observedAt" < EXCLUDED."observedAt"`;
      }
    } catch {
      report("persistence");
    } finally {
      flushing = false;
    }
  }
  void subscribe();
  const timer = setInterval(() => {
    void subscribe();
    void flush();
  }, 10000);
  return () => {
    closed = true;
    clearInterval(timer);
    orders.disconnect();
    stocks.disconnect();
    crypto.disconnect();
  };
}
