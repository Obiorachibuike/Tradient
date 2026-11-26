# Tradient

Tradient is a single-operator **Alpaca paper trading** terminal. Next.js and a Fastify API share PostgreSQL with a persistent pg-boss worker. The worker does not depend on a browser session. The application has no live-order path and starts with new entries disabled.

```sh
cp .env.example .env
# Set a strong operator key, then add Alpaca paper credentials.
docker compose up --build
# Open http://localhost:3000 and connect with the operator key.
```

Use a dedicated **paper** account; do not place independent orders on it while Tradient manages positions. Paper fills and historical simulations do not establish future profitability. The current release is a tested foundation, not a production certification or completion of every item in the master specification.

| Guide | Contents |
| --- | --- |
| [Setup](SETUP.md) | Local processes, database and tests |
| [Deployment](DEPLOYMENT.md) | Containers, networking, secrets and rollout |
| [Alpaca setup](ALPACA_SETUP.md) | Paper credentials, feeds and provider verification |
| [Trading strategies](TRADING_STRATEGIES.md) | Signals, strategy version and backtest assumptions |
| [Risk management](RISK_MANAGEMENT.md) | Sizing, breaker policy and execution limits |
| [API documentation](API_DOCUMENTATION.md) | Endpoints, WebSocket and authentication |
| [Incident response](INCIDENT_RESPONSE.md) | Stops, unknown submissions and recovery |
| [Technical assessment](docs/ASSESSMENT.md) | Baseline, implementation phases and remaining gaps |
