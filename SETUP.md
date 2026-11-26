# Local setup and validation

Requirements: Node.js 22 (22.12+), Corepack/pnpm, PostgreSQL 16+ or Docker Compose, and internet access to Alpaca for real integration. `pnpm install` and Prisma CLI migrations can require access to `binaries.prisma.sh` in addition to the npm registry.

1. Copy `.env.example` to `.env`. Generate the operator secret with `openssl rand -hex 32` and, if enabling AI, the distinct registry encryption key with `openssl rand -base64 32`.
2. Add only paper Alpaca credentials from your Alpaca dashboard. For Compose, `COMPOSE_DATABASE_URL` must match your `POSTGRES_PASSWORD` if you override the local default. URL-encode password characters in the connection URL. Do not reuse the example password outside local development.
3. Start `docker compose up --build`, or use existing PostgreSQL and run each service separately:

```sh
corepack enable
pnpm install --frozen-lockfile
set -a; . ./.env; set +a  # Source only a trusted operator-owned file.
pnpm migrate
pnpm api     # Terminal 1
pnpm worker  # Terminal 2, with the same environment loaded
pnpm dev     # Terminal 3; no provider secrets required here
```

The web server forwards relative `/terminal-api` requests to `API_INTERNAL_URL` (default `http://127.0.0.1:4000`); the browser never contacts that internal address directly. Sign in with `ADMIN_TOKEN`, not with your broker key. The session key is held in page memory. Close or reload to clear it. Bots start paused, and the account-wide circuit breaker must be explicitly armed.

```sh
pnpm test                   # Unit/contract mocks; optional groups skip without env
TRADIENT_TEST_DATABASE_URL="$DISPOSABLE_TEST_URL" pnpm test
pnpm build                  # Generates Prisma client, typechecks all services, builds Next.js
pnpm exec playwright install chromium
pnpm exec playwright test
```

Apply migrations to the disposable `*_test` database before enabling integration tests. The suite **truncates** application tables in it. See [Alpaca setup](ALPACA_SETUP.md) for the opt-in, read-only external contract check. The Playwright suite checks disconnected states and UI against mocked HTTP responses; PostgreSQL integration tests check real database state and a mocked Alpaca environment.

## AI setup

Set `AI_ENCRYPTION_KEY` on the API, then add your provider model and secret in **AI Model Management**. Agnes is primary (`agnes-2.5-flash` is the documented model ID at implementation time); OpenAI is an independently configured fallback. Use model-specific USD per million prices from your account. Enable the assignment and analyze a persisted signal from **AI Analysis**. The app does not use models to place or approve trades.

Daily UTC admission is restricted by `AI_DAILY_REQUESTS` and `AI_DAILY_USD` (hard app ceilings are 40 attempts and $10 estimated). Failed requests retain their reservation, and successful usage reconciles supplied token counts. This is an estimate, not a guarantee of the provider invoice; set a provider-side budget too. Provider keys are AES-GCM encrypted at rest; to rotate a provider secret, edit the model and supply the replacement. Master-key rotation requires a maintenance/re-encryption procedure; do not simply replace the master key while stored models depend on it.
