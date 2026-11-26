import type { Alpaca } from "./alpaca";
import { db } from "./db";
import { D } from "../lib/risk";

export async function accountAnalytics(api: Alpaca) {
  const [account, positions] = await Promise.all([
    api.account(),
    api.positions(),
  ]);
  const latest = await db.equitySnapshot.findFirst({
    orderBy: { time: "desc" },
  });
  if (latest && latest.accountId !== account.id)
    throw new Error("Account changed");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const week = new Date(today);
  week.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const month = new Date(today);
  month.setUTCDate(1);
  const baseline = (start: Date) =>
    db.equitySnapshot.findFirst({
      where: { accountId: account.id, time: { gte: start } },
      orderBy: { time: "asc" },
    });
  const [weekly, monthly, realized] = await Promise.all([
    baseline(week),
    baseline(month),
    db.$queryRaw<{ gross: string | null }[]>`
    SELECT SUM((sale."averageFill"-entry."averageFill")*sale."filledQuantity")::text AS gross
    FROM "Intent" sale JOIN "Intent" entry ON entry.id=sale."parentId"
    WHERE sale.side='sell' AND entry.side='buy' AND sale."filledQuantity">0`,
  ]);
  function change(row: typeof weekly) {
    return row
      ? {
          change: new D(account.equity).minus(row.equity.toFixed()).toFixed(),
          baseline: row.time,
        }
      : null;
  }
  const sum = (xs: string[]) =>
    xs.reduce((total, v) => total.plus(v), new D(0)).toFixed();
  return {
    weekly: change(weekly),
    monthly: change(monthly),
    realizedGross: realized[0]?.gross ?? null,
    unrealized: sum(positions.map((p) => p.unrealized_pl)),
    grossExposure: sum(
      positions.map((p) => new D(p.market_value).abs().toFixed()),
    ),
    cryptoExposure: sum(
      positions
        .filter((p) => p.asset_class === "crypto")
        .map((p) => new D(p.market_value).abs().toFixed()),
    ),
  };
}
