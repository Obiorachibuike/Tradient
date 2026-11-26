import type { Bar } from "../server/alpaca";
import type { strategies } from "../server/config";
import { evaluate } from "./indicators";
export function backtest(
  bars: Bar[],
  strategy: (typeof strategies)[number],
  capital: number,
  costBps = 15,
) {
  const cost = costBps / 10000;
  let cash = capital,
    peak = capital,
    drawdown = 0,
    costs = 0;
  let position: {
    entry: number;
    qty: number;
    stop: number;
    target: number;
    time: string;
  } | null = null;
  const trades: {
    entryTime: string;
    exitTime: string;
    entry: number;
    exit: number;
    quantity: number;
    pnl: number;
    reason: string;
  }[] = [];
  const curve: { time: string; equity: number }[] = [];
  for (let i = 200; i < bars.length; i++) {
    const b = bars[i];
    if (!position && i < bars.length - 1) {
      const signal = evaluate(bars.slice(Math.max(0, i - 500), i), strategy);
      if (signal?.entry) {
        const entry = b.o * (1 + cost),
          distance = signal.readings.atr * 2;
        const qty = Math.min(
          (cash * 0.005) / distance,
          (cash * 0.1) / entry,
          bars[i - 1].v * 0.01,
        );
        if (qty > 0 && entry > distance) {
          position = {
            entry,
            qty,
            stop: entry - distance,
            target: entry + distance * 2,
            time: b.t,
          };
          cash -= entry * qty;
          costs += (entry - b.o) * qty;
        }
      }
    }
    if (position) {
      const hitStop = b.l <= position.stop,
        hitTarget = b.h >= position.target;
      if (hitStop || hitTarget || i === bars.length - 1) {
        const raw = hitStop
          ? Math.min(b.o, position.stop)
          : hitTarget
            ? position.target
            : b.c;
        const exit = raw * (1 - cost);
        cash += position.qty * exit;
        costs += (raw - exit) * position.qty;
        trades.push({
          entryTime: position.time,
          exitTime: b.t,
          entry: position.entry,
          exit,
          quantity: position.qty,
          pnl: (exit - position.entry) * position.qty,
          reason: hitStop ? "stop" : hitTarget ? "target" : "end",
        });
        position = null;
      }
    }
    const equity = cash + (position ? b.c * position.qty : 0);
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
    curve.push({ time: b.t, equity });
  }
  const wins = trades.filter((t) => t.pnl > 0),
    losses = trades.filter((t) => t.pnl < 0),
    total = (xs: typeof trades) => xs.reduce((a, b) => a + b.pnl, 0);
  return {
    version: "technical-v1",
    netReturn: cash / capital - 1,
    drawdown,
    costs,
    winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: losses.length ? total(wins) / -total(losses) : null,
    expectancy: trades.length ? total(trades) / trades.length : null,
    averageWin: wins.length ? total(wins) / wins.length : null,
    averageLoss: losses.length ? total(losses) / losses.length : null,
    trades,
    curve,
  };
}
