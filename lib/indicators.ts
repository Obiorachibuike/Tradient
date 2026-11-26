import type { Bar } from "../server/alpaca";
import type { strategies } from "../server/config";
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export function ema(values: number[], n: number) {
  if (n < 1 || values.length < n) return [];
  const out = [mean(values.slice(0, n))];
  for (const x of values.slice(n))
    out.push(out.at(-1)! + ((x - out.at(-1)!) * 2) / (n + 1));
  return out;
}
function wilder(values: number[], n: number) {
  if (values.length < n) return [];
  const out = [mean(values.slice(0, n))];
  for (const x of values.slice(n)) out.push((out.at(-1)! * (n - 1) + x) / n);
  return out;
}
export function indicators(bars: Bar[]) {
  if (bars.length < 200) return null;
  const closes = bars.map((x) => x.c),
    price = closes.at(-1)!;
  const [e9, e21, e50, e200] = [9, 21, 50, 200].map((n) =>
    ema(closes, n).at(-1)!,
  );
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gain = wilder(
    changes.map((x) => Math.max(0, x)),
    14,
  ).at(-1)!;
  const loss = wilder(
    changes.map((x) => Math.max(0, -x)),
    14,
  ).at(-1)!;
  const rsi =
    loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  const fast = ema(closes, 12).slice(14),
    slow = ema(closes, 26);
  const macdSeries = slow.map((s, i) => fast[i] - s),
    signal = ema(macdSeries, 9);
  const macd = macdSeries.at(-1)!,
    histogram = macd - signal.at(-1)!;
  const ranges = bars
    .slice(1)
    .map((x, i) =>
      Math.max(x.h - x.l, Math.abs(x.h - bars[i].c), Math.abs(x.l - bars[i].c)),
    );
  const atrSeries = wilder(ranges, 14),
    atr = atrSeries.at(-1)!;
  const moves = bars.slice(1).map((x, i) => [x.h - bars[i].h, bars[i].l - x.l]);
  const plus = wilder(
    moves.map(([p, m]) => (p > Math.max(0, m) ? p : 0)),
    14,
  );
  const minus = wilder(
    moves.map(([p, m]) => (m > Math.max(0, p) ? m : 0)),
    14,
  );
  const adx = wilder(
    plus.map((p, i) =>
      p + minus[i] === 0 ? 0 : (100 * Math.abs(p - minus[i])) / (p + minus[i]),
    ),
    14,
  ).at(-1)!;
  const window = closes.slice(-20),
    mid = mean(window),
    sd = Math.sqrt(mean(window.map((c) => (c - mid) ** 2)));
  const recent = bars.slice(-20),
    vol = recent.reduce((a, b) => a + b.v, 0);
  const vwap = vol
    ? recent.reduce((a, b) => a + ((b.h + b.l + b.c) / 3) * b.v, 0) / vol
    : null;
  const volumeSma = mean(bars.slice(-21, -1).map((b) => b.v));
  const ratio = volumeSma ? bars.at(-1)!.v / volumeSma : 0;
  const regime =
    atr / price > 0.08
      ? "high-volatility"
      : atr / price < 0.002
        ? "low-volatility"
        : adx < 20
          ? "sideways"
          : e21 > e50 && price > e200
            ? "bullish"
            : e21 < e50 && price < e200
              ? "bearish"
              : "uncertain";
  return {
    price,
    e9,
    e21,
    e50,
    e200,
    rsi,
    macd,
    histogram,
    previousHistogram: macdSeries.at(-2)! - signal.at(-2)!,
    atr,
    adx,
    mid,
    upper: mid + 2 * sd,
    lower: mid - 2 * sd,
    vwap,
    volumeSma,
    ratio,
    regime,
    breakout: Math.max(...bars.slice(-21, -1).map((b) => b.h)),
  };
}
export function evaluate(bars: Bar[], strategy: (typeof strategies)[number]) {
  const x = indicators(bars);
  if (!x) return null;
  const trend = x.e9 > x.e21 && x.e21 > x.e50 && x.price > x.e200;
  const momentum = x.rsi >= 52 && x.rsi <= 75 && x.histogram > 0;
  const volume = x.ratio >= 1.2,
    volatility = x.atr / x.price >= 0.002 && x.atr / x.price <= 0.05;
  const tests = {
    ema: trend,
    rsi: x.rsi >= 55 && x.rsi <= 68,
    macd: x.previousHistogram <= 0 && x.histogram > 0,
    bollinger: x.price < x.lower && x.rsi < 35,
    vwap: x.vwap !== null && x.price > x.vwap && trend,
    breakout: x.price > x.breakout && volume,
    confluence: trend && momentum && volume,
  };
  const components = {
    trend: trend ? 25 : 0,
    momentum: momentum ? 20 : 0,
    volume: volume ? 15 : 0,
    volatility: volatility ? 10 : 0,
    regime: x.regime === "bullish" ? 15 : 0,
    ai: 0,
  };
  // Mean reversion scores alignment with a sideways, oversold setup rather than an uptrend.
  if (strategy === "bollinger") {
    components.trend = x.adx < 20 ? 25 : 0;
    components.momentum = x.rsi < 35 ? 20 : 0;
    components.regime = x.regime === "sideways" ? 15 : 0;
  }
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  return {
    readings: x,
    components,
    score,
    entry: tests[strategy] && score >= 75 && x.atr > 0,
    version: "technical-v1",
    explanation: `${strategy}: setup ${tests[strategy] ? "matched" : "did not match"}; technical score ${score}/100 (AI unused)`,
  };
}
