import { expect, it } from "vitest";
import { Alpaca } from "../server/alpaca";

it.skipIf(process.env.RUN_ALPACA_PAPER_CONTRACT !== "true")(
  "validates real Alpaca paper account, stock and crypto data without submitting orders",
  async () => {
    const api = new Alpaca();
    expect((await api.account()).status).toBe("ACTIVE");
    expect(
      (await api.assets("us_equity")).some(
        (a) => a.symbol === "SPY" && a.tradable,
      ),
    ).toBe(true);
    expect(
      (await api.assets("crypto")).some(
        (a) => a.symbol === "BTC/USD" && a.tradable,
      ),
    ).toBe(true);
    expect(await api.asset("BTC/USD")).toMatchObject({
      class: "crypto",
      tradable: true,
    });
    const end = new Date(),
      start = new Date(+end - 7 * 86400000);
    expect(
      (await api.bars("SPY", "us_equity", "1Hour", start, end)).length,
    ).toBeGreaterThan(0);
    expect(
      (await api.bars("BTC/USD", "crypto", "1Hour", start, end)).length,
    ).toBeGreaterThan(0);
  },
  30000,
);
