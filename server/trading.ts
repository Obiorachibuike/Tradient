import { randomUUID } from "node:crypto";
import {
  Alpaca,
  BrokerError,
  type AssetClass,
  type Bar,
  type orderSchema,
} from "./alpaca";
import type { z } from "zod";
import { db, control, exclusive } from "./db";
import { D, floor, sizeEntry, lossLimit } from "../lib/risk";
import { evaluate } from "../lib/indicators";
import { botInput, intervals, timeframes } from "./config";
const terminal = ["filled", "canceled", "expired", "rejected", "abandoned"];
const pending = { notIn: terminal };
const quoteFresh = (t: string) => {
  const age = Date.now() - Date.parse(t);
  return age >= -1000 && age <= 30000;
};
export async function recordOrder(order: z.infer<typeof orderSchema>) {
  const intent = await db.intent.findUniqueOrThrow({
    where: { id: order.client_order_id },
  });
  if (
    intent.side !== order.side ||
    intent.symbol.replace("/", "") !== order.symbol.replace("/", "")
  )
    throw new Error("Unexpected broker order");
  return db.intent.update({
    where: { id: intent.id },
    data: {
      status: order.status,
      brokerId: order.id,
      filledQuantity: order.filled_qty,
      averageFill: order.filled_avg_price,
    },
  });
}
export async function reconcile(alpaca: Alpaca) {
  for (const i of await db.intent.findMany({ where: { status: pending } })) {
    try {
      const order = await alpaca.order(i.id);
      if (order.client_order_id !== i.id)
        throw new Error("Unexpected broker order ID");
      await recordOrder(order);
    } catch (e) {
      if (!(e instanceof BrokerError && e.status === 404)) throw e;
      // Only "created" is provably unsent. Never resubmit an ambiguous POST.
      if (i.status === "created" && Date.now() - i.createdAt.getTime() > 60000)
        await db.intent.updateMany({
          where: { id: i.id, status: "created" },
          data: { status: "abandoned" },
        });
    }
  }
}
async function submit(
  alpaca: Alpaca,
  id: string,
  deadline: number,
  botId?: string,
) {
  // The claim is committed before I/O. A crash after claiming is treated as unknown.
  if (
    !(
      await db.intent.updateMany({
        where: { id, status: "created" },
        data: { status: "unknown" },
      })
    ).count
  )
    return;
  await exclusive(async (tx) => {
    const i = await tx.intent.findUniqueOrThrow({ where: { id } });
    if (
      i.side === "buy" &&
      ((await tx.control.findUnique({ where: { id: 1 } }))?.stopped !== false ||
        !botId ||
        !(await tx.bot.findUnique({ where: { id: botId } }))?.enabled)
    ) {
      await tx.intent.update({ where: { id }, data: { status: "abandoned" } });
      return;
    }
    if (Date.now() > deadline || Date.now() - i.createdAt.getTime() > 15000) {
      await tx.intent.update({ where: { id }, data: { status: "abandoned" } });
      return;
    }
    const order = await alpaca.submit({
      id,
      symbol: i.symbol,
      assetClass: i.assetClass as AssetClass,
      side: i.side as "buy" | "sell",
      quantity: i.quantity.toFixed(),
      limitPrice: i.limitPrice.toFixed(),
    });
    if (
      order.client_order_id !== id ||
      order.side !== i.side ||
      order.symbol.replace("/", "") !== i.symbol.replace("/", "")
    )
      throw new Error("Unexpected broker response");
    await tx.intent.update({
      where: { id },
      data: {
        status: order.status,
        brokerId: order.id,
        filledQuantity: order.filled_qty,
        averageFill: order.filled_avg_price,
      },
    });
  });
}
export async function history(
  alpaca: Alpaca,
  symbol: string,
  cls: AssetClass,
  tf: (typeof timeframes)[number],
) {
  const seconds = intervals[timeframes.indexOf(tf)],
    source = alpaca.source(cls),
    now = new Date();
  const scope = { symbol, source, timeframe: tf };
  const cached = await db.marketBar.findMany({
    where: scope,
    orderBy: { time: "desc" },
    take: 500,
  });
  const lookback =
    seconds * 1000 * (cls === "crypto" ? 320 : tf === "1Day" ? 400 : 2400);
  const start = new Date(
    cached.length >= 210 && now.getTime() - cached[0].time.getTime() < lookback
      ? cached[0].time.getTime() - seconds * 2000
      : now.getTime() - lookback,
  );
  const fresh = (await alpaca.bars(symbol, cls, tf, start, now)).filter(
    (b) => Date.parse(b.t) + seconds * 1000 <= now.getTime(),
  );
  const rows = fresh.map((b) => ({
    ...scope,
    time: new Date(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
  if (rows.length)
    await db.marketBar.createMany({ data: rows, skipDuplicates: true });
  const combined = new Map<number, Bar>(
    cached.map((b) => [
      b.time.getTime(),
      {
        t: b.time.toISOString(),
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume,
      },
    ]),
  );
  for (const b of fresh) combined.set(Date.parse(b.t), b);
  return [...combined.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-500)
    .map(([, b]) => b);
}
function assetRules(
  asset: Awaited<ReturnType<Alpaca["asset"]>>,
  cls: AssetClass,
  ask: number,
) {
  if (!asset.tradable || asset.status !== "active" || asset.class !== cls)
    return null;
  if (cls === "crypto")
    return asset.min_trade_increment &&
      asset.price_increment &&
      asset.min_order_size
      ? {
          qtyStep: asset.min_trade_increment,
          priceStep: asset.price_increment,
          minimum: asset.min_order_size,
        }
      : null;
  return { qtyStep: "1", priceStep: ask >= 1 ? ".01" : ".0001", minimum: "1" };
}
async function isRegularSession(alpaca: Alpaca) {
  const clock = await alpaca.clock();
  return clock.is_open && Date.parse(clock.next_close) - Date.now() > 30000;
}
export async function tick(alpaca: Alpaca) {
  // Trading admission expires before the outer job or its advisory transaction can expire.
  const deadline = Date.now() + 90000;
  const account = await alpaca.account();
  if (
    account.status !== "ACTIVE" ||
    account.account_blocked ||
    account.trading_blocked
  )
    throw new Error("Paper account not available for trading");
  const now = new Date(),
    day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const week = new Date(day);
  week.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const prior = await db.equitySnapshot.findFirst({
    orderBy: { time: "desc" },
  });
  if (prior && prior.accountId !== account.id)
    throw new Error("Account changed; use a separate database");
  await reconcile(alpaca);
  await db.equitySnapshot.create({
    data: {
      accountId: account.id,
      equity: account.equity,
      buyingPower: account.buying_power,
    },
  });
  for (const [start, limit, name] of [
    [day, ".02", "Daily equity loss"],
    [week, ".04", "Weekly equity loss"],
  ] as const) {
    const baseline = await db.equitySnapshot.findFirst({
      where: { time: { gte: start }, accountId: account.id },
      orderBy: { time: "asc" },
    });
    if (baseline && lossLimit(account.equity, baseline.equity.toFixed(), limit))
      await exclusive(async (tx) => {
        const current = await tx.control.upsert({
          where: { id: 1 },
          create: { id: 1 },
          update: {},
        });
        if (!current.stopped) {
          await tx.control.update({
            where: { id: 1 },
            data: { stopped: true, reason: name },
          });
          await tx.audit.create({
            data: { event: "risk.stop", detail: { reason: name } },
          });
        }
      });
  }
  const state = await control(),
    orders = await alpaca.openOrders();
  const buys = await db.intent.findMany({
    where: { side: "buy", status: pending },
  });
  for (const o of orders)
    if (
      o.side === "buy" &&
      buys.some(
        (i) =>
          i.id === o.client_order_id &&
          (state.stopped || Date.now() - i.createdAt.getTime() > 60000),
      )
    )
      await alpaca.cancel(o.id);
  if (orders.length || (await db.intent.count({ where: { status: pending } })))
    return;
  const positions = await alpaca.positions();
  if (positions.length) {
    // Never adopt unmanaged inventory; exits use reconciled fills and available quantity.
    for (const p of positions) {
      const sym = p.symbol.replace("/", "");
      const aliases = [p.symbol];
      if (p.asset_class === "crypto" && sym.endsWith("USD"))
        aliases.push(`${sym.slice(0, -3)}/USD`);
      const entry = await db.intent.findFirst({
        where: {
          symbol: { in: aliases },
          assetClass: p.asset_class,
          side: "buy",
          filledQuantity: { gt: 0 },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!entry?.stop || !entry.target || !p.qty_available) continue;
      const sales = (
        await db.intent.findMany({
          where: {
            symbol: entry.symbol,
            side: "sell",
            createdAt: { gte: entry.createdAt },
          },
        })
      ).reduce((sum, i) => sum.plus(i.filledQuantity.toFixed()), new D(0));
      if (new D(entry.filledQuantity.toFixed()).minus(sales).lt(p.qty))
        continue;
      const cls = entry.assetClass as AssetClass;
      if (cls === "us_equity" && !(await isRegularSession(alpaca))) continue;
      const [asset, q] = await Promise.all([
        alpaca.asset(entry.symbol),
        alpaca.quote(entry.symbol, cls),
      ]);
      const rules = assetRules(asset, cls, q.ap);
      if (
        !rules ||
        !quoteFresh(q.t) ||
        q.ap < q.bp ||
        p.asset_class !== cls ||
        asset.symbol.replace("/", "") !== sym ||
        new D(q.ap).minus(q.bp).div(q.ap).gt(".01")
      )
        continue;
      if (
        new D(q.bp).gt(entry.stop.toFixed()) &&
        new D(q.bp).lt(entry.target.toFixed())
      )
        continue;
      const qty = floor(D.min(p.qty, p.qty_available), rules.qtyStep),
        price = floor(q.bp, rules.priceStep);
      if (qty.lt(rules.minimum) || price.lte(0)) continue;
      const id = await exclusive(async (tx) => {
        if (
          Date.now() > deadline ||
          (await tx.intent.count({ where: { status: pending } }))
        )
          return null;
        const id = randomUUID();
        await tx.intent.create({
          data: {
            id,
            symbol: entry.symbol,
            assetClass: cls,
            side: "sell",
            parentId: entry.id,
            quantity: qty.toFixed(),
            limitPrice: price.toFixed(),
            status: "created",
          },
        });
        return id;
      });
      if (id) await submit(alpaca, id, deadline);
      return;
    }
    return; // Conservative release: a single account-wide position, including external holdings.
  }
  if (state.stopped) return;
  for (const row of await db.bot.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  })) {
    if (Date.now() > deadline) return;
    const bot = botInput.parse(row),
      cls = bot.assetClass;
    if (cls === "us_equity" && !(await isRegularSession(alpaca))) continue;
    if (cls === "crypto" && account.crypto_status !== "ACTIVE") continue;
    const bars = await history(alpaca, bot.symbol, cls, bot.timeframe),
      last = bars.at(-1);
    if (
      !last ||
      Date.now() - Date.parse(last.t) >
        intervals[timeframes.indexOf(bot.timeframe)] * 2000
    )
      continue;
    const signal = evaluate(bars, bot.strategy);
    if (!signal) continue;
    const candle = new Date(last.t),
      key = { botId: row.id, candle };
    if (await db.signal.findUnique({ where: { botId_candle: key } })) continue;
    let sized: ReturnType<typeof sizeEntry> = null;
    if (signal.entry) {
      const [asset, q] = await Promise.all([
        alpaca.asset(bot.symbol),
        alpaca.quote(bot.symbol, cls),
      ]);
      const rules = assetRules(asset, cls, q.ap);
      if (
        rules &&
        asset.symbol.replace("/", "") === bot.symbol.replace("/", "") &&
        quoteFresh(q.t) &&
        Math.abs(q.ap / last.c - 1) < 0.02
      ) {
        // IEX quote sizes are round lots; treat as shares conservatively.
        sized = sizeEntry({
          ...rules,
          equity: account.equity,
          cash: account.cash,
          buyingPower: account.buying_power,
          ask: q.ap,
          bid: q.bp,
          displayed: q.as,
          atr: signal.readings.atr,
        });
      }
    }
    const id = await exclusive(async (tx) => {
      if (await tx.signal.findUnique({ where: { botId_candle: key } }))
        return null;
      const stopped =
        (await tx.control.findUnique({ where: { id: 1 } }))?.stopped !== false;
      const enabled = (await tx.bot.findUnique({ where: { id: row.id } }))
        ?.enabled;
      const approved =
        sized &&
        Date.now() < deadline &&
        !stopped &&
        enabled &&
        !(await tx.intent.count({ where: { status: pending } }));
      const savedSignal = await tx.signal.create({
        data: {
          ...key,
          version: signal.version,
          score: signal.score,
          readings: { ...signal, source: alpaca.source(cls) },
          decision: approved
            ? "approved"
            : signal.entry
              ? "risk-rejected"
              : "no-entry",
        },
      });
      if (!approved || !sized) return null;
      const id = randomUUID();
      await tx.intent.create({
        data: {
          id,
          symbol: bot.symbol,
          assetClass: cls,
          side: "buy",
          signalId: savedSignal.id,
          ...sized,
          status: "created",
        },
      });
      return id;
    });
    if (id) {
      await submit(alpaca, id, deadline, row.id);
      return;
    }
  }
}
