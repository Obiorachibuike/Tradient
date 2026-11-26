# Alpaca paper connectivity

Set `ALPACA_PAPER_TRADE=true` and `ALPACA_LIVE_TRADE=false`. The application pins trading to `https://paper-api.alpaca.markets` and data to `https://data.alpaca.markets`. Conflicting URLs/flags fail before a request. A live-only key is rejected by the pinned paper endpoint; the worker requires a successful active account probe. Do not use or transmit live keys. Keep account keys in the runtime's secret store, not in the browser or database.

Create paper keys in the Alpaca dashboard. Verify the account is active and not trading-blocked. Check access to the IEX stock feed and US crypto route; exchange, availability and region restrictions still apply. Execution supports whole-share US stocks/eligible ETFs and USD crypto pairs only. Equities use regular-session day limit orders; crypto uses IOC limit orders and broker-specified increments. The app is long-only, avoids margin by capping on cash, and does not use extended-hours execution.

The server REST wrapper uses schema-validated wire responses, no redirects, and explicit paper hosts. Trade updates and the IEX/US crypto market streams use the official [Alpaca JavaScript SDK](https://github.com/alpacahq/alpaca-trade-api). Trade notifications prompt REST reconciliation; they are never treated alone as a fill. Persisted market samples and bars are labeled by source. WebSocket or market data entitlement failure does not substitute synthetic values.

Opt-in account/data check (no order submission):

```sh
set -a; . ./.env; set +a
RUN_ALPACA_PAPER_CONTRACT=true pnpm exec vitest run tests/paper-contract.test.ts
```

Before trusting order execution, supervise a minimal paper lifecycle using a dedicated account and real market data. Verify broker acceptance, cancellation, filled quantities, cash/positions, duplicate prevention and emergency-stop behavior in both UIs. This repository's broker-side lifecycle was exercised with a mock, not an external Alpaca paper order.
