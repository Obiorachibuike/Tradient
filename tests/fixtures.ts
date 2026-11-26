export const env = {
  ALPACA_PAPER_TRADE: "true",
  ALPACA_LIVE_TRADE: "false",
  ALPACA_API_KEY: "fake-key",
  ALPACA_SECRET_KEY: "fake-secret",
};
export function candles(at = Date.now()) {
  return Array.from({ length: 202 }, (_, i) => {
    const c = 100 + i * 0.1 + Math.sin(i * 0.7) * 1.2;
    return {
      t: new Date(at - (202 - i) * 60000 - 10000).toISOString(),
      o: c,
      c,
      h: c + 0.7,
      l: c - 0.7,
      v: i === 201 ? 2000 : 1000,
    };
  });
}
