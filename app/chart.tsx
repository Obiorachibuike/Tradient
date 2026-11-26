"use client";
import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";
export type Candle = { t: string; o: number; h: number; l: number; c: number };
export default function Chart({
  points,
  candles,
}: {
  points?: { time: string; equity: number | string }[];
  candles?: Candle[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || (!points?.length && !candles?.length)) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: "#111517" },
        textColor: "#a1acab",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#202728" },
        horzLines: { color: "#202728" },
      },
      rightPriceScale: { borderColor: "#292f30" },
      timeScale: { borderColor: "#292f30", timeVisible: true },
    });
    const ts = (s: string) => ((Date.parse(s) / 1000) | 0) as UTCTimestamp;
    if (candles?.length) {
      chart
        .addSeries(CandlestickSeries, {
          upColor: "#57e4a4",
          downColor: "#f47785",
          borderVisible: false,
          wickUpColor: "#57e4a4",
          wickDownColor: "#f47785",
        })
        .setData(
          candles.map((b) => ({
            time: ts(b.t),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
          })),
        );
    } else if (points?.length) {
      const data = new Map<number, number>();
      points.forEach((p) => data.set(ts(p.time), Number(p.equity)));
      chart
        .addSeries(AreaSeries, {
          lineColor: "#57e4a4",
          topColor: "#57e4a436",
          bottomColor: "#57e4a400",
          lineWidth: 2,
        })
        .setData(
          [...data.entries()]
            .sort(([a], [b]) => a - b)
            .map(([time, value]) => ({ time: time as UTCTimestamp, value })),
        );
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, candles]);
  return <div ref={ref} className="chart" />;
}
