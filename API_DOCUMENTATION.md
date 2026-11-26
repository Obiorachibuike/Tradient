# HTTP and realtime contract

Fastify defaults to port 4000. Next.js forwards `/terminal-api/<path>` to the private Fastify origin. Except `GET /health`, routes require `Authorization: Bearer <ADMIN_TOKEN>`. No provider keys appear in responses. Requests are schema-validated, rate limited, and payload sizes are bounded. Do not expose the internal API directly to the public internet.

| Method | Path | Result or input |
| --- | --- | --- |
| GET | `/health` | Process liveness and paper mode |
| GET | `/ready` | DB and paper account probe |
| GET | `/overview` | Control, bots, intents/fills to date, signal records, equity, heartbeat, recent audit and broker account/positions (nullable on outage) |
| GET | `/analytics` | Snapshot-based weekly/monthly equity change, broker exposure/unrealized P&L, and attributed gross realized P&L |
| GET | `/assets` | `assetClass=us_equity\|crypto`, optional `q`; up to 100 tradable matches |
| GET | `/bars` | `symbol`, `assetClass`, `timeframe`; normalized completed bars and indicators |
| GET | `/market-sample` | `symbol`, `assetClass`; latest validated, fresh sampled quote/trade |
| POST | `/bots` | `{symbol,assetClass,timeframe,strategy}`; creates a disabled bot |
| PATCH | `/bots/:id` | `{enabled:boolean}` |
| POST | `/control` | `{action:"stop"}` or `{action:"resume",confirmation:"RESUME PAPER TRADING"}` |
| POST | `/backtest` | Bot parameters plus `start`, exclusive `end` (ISO dates), `capital`, optional `costBps` |
| GET | `/backtest/:id` | Historical run by ID |
| GET | `/ai-models` | Model registry metadata (no secrets), recent usage |
| POST | `/ai-models` | `{provider,name,role,enabled,key?,maxTokens,timeoutMs,inputUsdPerMillion,outputUsdPerMillion}`; rates as decimals in strings. Key required for new models. |
| POST | `/analysis` | `{id}` of a recorded signal; structured advisory interpretation, cached per signal for up to one hour |

WebSocket `/events`: send `Bearer <ADMIN_TOKEN>` as the first frame within four seconds. No state is sent before credential verification. Socket events are **invalidations**, not an authoritative event log. After `system.resync`, reconnect, or a relevant invalidation, load `/overview` and market state over HTTP. The terminal polls during degraded connections. Postgres `LISTEN` is session-scoped; use direct PostgreSQL or a session-mode pool for the API, not a transaction-pooled URL. Market samples are display-only; worker execution requires fresh broker REST data.

Supported timeframe input: `1Min`, `5Min`, `15Min`, `1Hour`, `4Hour`, `1Day`. Strategies: `ema`, `rsi`, `macd`, `bollinger`, `vwap`, `breakout`, `confluence`. Crypto must be `BASE/USD`.
