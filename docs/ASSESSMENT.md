# Technical assessment and delivery status

The base commit contained only `README.md` (`# Tradient`). There were no dependencies, routes, components, authentication, models, provider integrations, tests or deployment files. No architecture needed replacement. Built a single pnpm workspace with separate web, API and persistent worker entrypoints; framework-independent strategy, sizing and simulation modules are under `lib/`.

## Delivery phases

1. Define PostgreSQL state and paper-only connectivity; add migrations and unit contracts.
2. Add indicators, deterministic scoring, fail-closed risk decisions, durable order intents and reconciliation.
3. Run a persistent pg-boss loop, broker streams and authenticated state invalidations; integrate the terminal UI.
4. Add single-asset simulation persistence and a separately authorized advisory provider registry.
5. Verify with unit/contract mocks, disposable PostgreSQL, Fastify and Playwright; add deployment and incident runbooks.

## Current database and queues

Prisma: `Control`, `Bot`, `Signal`, `Intent`, `MarketBar`, `MarketEvent`, `EquitySnapshot`, `Heartbeat`, `Audit`, `BacktestRun`, `AIModel`, `AIUsage`. Bot/candle and broker ID uniqueness, transaction-guarded claims and advisory locks prevent ordinary duplicate execution. Order, fill totals and protective levels are recorded on intents; authoritative current positions come from Alpaca. pg-boss uses `paper-tick` with a dead-letter queue, bounded execution and no automatic submission retries. Broker updates can enqueue a deduplicated sync tick. This is not the ten-queue topology in the master prompt.

## Gaps to full acceptance

- External credentials and services were unavailable for a real Alpaca or AI provider validation; no deployment or real paper-order submission was performed here. The opt-in Alpaca data contract is read-only. Network entitlements, quote shapes and actual order acceptance must be verified in the target environment.
- Single-operator bearer authentication, not multi-user login, sessions or RBAC. No Sentry/OTel, email/Telegram, external readiness probes or managed alerting. Credentials are server-injected for Alpaca; the AI registry encrypts its provider keys. No in-app master-key rotation.
- Strategies have fixed `technical-v1` rules and global hard limits; no custom version registry, multi-asset portfolios, correlation controls, daily drawdown or loss-streak rules. No broker-hosted protective orders, trailing/partial exit policy or operational override for unresolved intents.
- Real-time feeds are sampled and limited to enabled bot instruments. Trading decisions use REST; no market replay, aggregated tick-based secondary timeframes, standalone watchlist manager or complete event catalog. Some venue, halt and calendar behavior is reflected only through Alpaca asset/clock/quote data.
- AI uses technical signal context only; no financial news/sentiment ingestion or required AI confirmations. Provider health is observable through persisted request success/failure, not a dedicated external probe. Request budget is enforced with operator-configured estimated costs, not provider invoice accounting.
- Backtesting is single-asset, synchronous, and does not meet walk-forward, train/holdout, parameter sweeps, Monte Carlo or point-in-time universe requirements. Portfolio analytics include snapshot-based weekly/monthly change, exposure, and linked-intent gross realized P&L; they do not include net fees or detailed strategy attribution. Database schema is intentionally narrower than the master prompt.
