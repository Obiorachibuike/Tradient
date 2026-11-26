import { z } from "zod";
export const timeframes = [
  "1Min",
  "5Min",
  "15Min",
  "1Hour",
  "4Hour",
  "1Day",
] as const;
export const intervals = [60, 300, 900, 3600, 14400, 86400];
export const strategies = [
  "ema",
  "rsi",
  "macd",
  "bollinger",
  "vwap",
  "breakout",
  "confluence",
] as const;
export const instrument = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9.]{1,12}(\/[A-Z0-9]{1,12})?$/),
    assetClass: z.enum(["us_equity", "crypto"]),
  })
  .refine((x) =>
    x.assetClass === "crypto"
      ? x.symbol.endsWith("/USD")
      : !x.symbol.includes("/"),
  );
export const botInput = instrument.and(
  z.object({ timeframe: z.enum(timeframes), strategy: z.enum(strategies) }),
);
export const paperTrading = "https://paper-api.alpaca.markets";
export const marketData = "https://data.alpaca.markets";
export function credentials(
  env: Record<string, string | undefined> = process.env,
) {
  if (
    env.ALPACA_PAPER_TRADE !== "true" ||
    env.ALPACA_LIVE_TRADE !== "false" ||
    (env.ALPACA_TRADING_BASE_URL ?? paperTrading) !== paperTrading ||
    (env.ALPACA_DATA_BASE_URL ?? marketData) !== marketData
  )
    throw new Error("Invalid paper trading policy");
  return z
    .object({
      ALPACA_API_KEY: z.string().min(1),
      ALPACA_SECRET_KEY: z.string().min(1),
    })
    .parse(env);
}
