"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Chart, { type Candle } from "./chart";
const nav = [
  ["Overview", "overview"],
  ["Markets", "markets"],
  ["Trading Bots", "bots"],
  ["Positions", "positions"],
  ["Orders", "orders"],
  ["Risk Management", "risk"],
  ["Backtesting", "backtest"],
  ["AI Analysis", "analysis"],
  ["AI Model Management", "models"],
  ["Notifications", "notifications"],
  ["Settings", "settings"],
  ["Strategies", "strategies"],
  ["Analytics", "analytics"],
] as const;
const glyphs = [
  "◫",
  "⌁",
  "◈",
  "▱",
  "▤",
  "⬡",
  "◷",
  "✧",
  "▣",
  "◉",
  "⚙",
  "⧉",
  "⌗",
];
const frames = ["1Min", "5Min", "15Min", "1Hour", "4Hour", "1Day"];
const strategies = [
  "ema",
  "rsi",
  "macd",
  "bollinger",
  "vwap",
  "breakout",
  "confluence",
];
const strategyLabels = [
  "EMA trend following",
  "RSI momentum",
  "MACD crossover",
  "Bollinger mean reversion",
  "VWAP continuation",
  "Breakout confirmation",
  "Multi-indicator confluence",
];
type Bot = {
  id: string;
  symbol: string;
  assetClass: string;
  timeframe: string;
  strategy: string;
  enabled: boolean;
};
type Intent = {
  id: string;
  symbol: string;
  side: string;
  status: string;
  quantity: string;
  filledQuantity: string;
  createdAt: string;
};
type Signal = {
  id: string;
  botId: string;
  score: number;
  decision: string;
  candle: string;
};
type Overview = {
  state: { stopped: boolean; reason: string };
  bots: Bot[];
  intents: Intent[];
  signals: Signal[];
  equity: { time: string; equity: string }[];
  heartbeat: { time: string } | null;
  audit: { id: string; event: string; time: string }[];
  broker: {
    account: { equity: string; buying_power: string; last_equity: string };
    positions: {
      symbol: string;
      qty: string;
      market_value: string;
      unrealized_pl: string;
    }[];
  } | null;
};
type Analytics = {
  weekly: { change: string; baseline: string } | null;
  monthly: { change: string; baseline: string } | null;
  realizedGross: string | null;
  unrealized: string;
  grossExposure: string;
  cryptoExposure: string;
};
type Simulation = {
  netReturn: number;
  drawdown: number;
  costs: number;
  winRate: number | null;
  profitFactor: number | null;
  trades: {
    entryTime: string;
    exitTime: string;
    entry: number;
    exit: number;
    quantity: number;
    pnl: number;
    reason: string;
  }[];
  curve: { time: string; equity: number }[];
  source: string;
  version: string;
};
type Registry = {
  models: {
    id: string;
    provider: string;
    name: string;
    role: string;
    enabled: boolean;
    maxTokens: number;
    timeoutMs: number;
    inputUsdPerMillion: string;
    outputUsdPerMillion: string;
  }[];
  usage: {
    id: string;
    provider: string;
    model: string;
    status: string;
    estimatedUsd: string;
    createdAt: string;
  }[];
};
type Analysis = {
  analysis: {
    marketRegime: string;
    recommendation: string;
    confidence: number;
    reasoning: string[];
    risks: string[];
    invalidationConditions: string[];
  };
  model: string;
};
const money = (n: number | string | undefined) =>
  n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(n));
const date = (s: string) => new Date(s).toLocaleString();
const pct = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(2)}%`;
export default function Page() {
  const [tab, setTab] = useState<(typeof nav)[number][1]>("overview"),
    [token, setToken] = useState(""),
    [draft, setDraft] = useState(""),
    [data, setData] = useState<Overview>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connect, setConnect] = useState(false),
    [confirm, setConfirm] = useState("");
  const [assetClass, setClass] = useState("us_equity"),
    [symbol, setSymbol] = useState(""),
    [timeframe, setFrame] = useState("15Min"),
    [strategy, setStrategy] = useState("ema"),
    [bars, setBars] = useState<{
      bars: Candle[];
      source: string;
      indicators: Record<string, unknown> | null;
    }>(),
    [assets, setAssets] = useState<{ symbol: string; class: string }[]>([]),
    [result, setResult] = useState<Simulation>(),
    [analysis, setAnalysis] = useState<Analysis>(),
    [signalId, setSignalId] = useState("");
  const [analytics, setAnalytics] = useState<Analytics>();
  const [registry, setRegistry] = useState<Registry>(),
    [modelProvider, setModelProvider] = useState("agnes"),
    [editing, setEditing] = useState<Registry["models"][number]>();
  const [socketReady, setSocketReady] = useState(false),
    [marketKey, setMarketKey] = useState<{
      symbol: string;
      assetClass: string;
    }>(),
    [samples, setSamples] = useState<
      {
        kind: string;
        observedAt: string;
        source: string;
        payload: { price?: number; bid?: number; ask?: number };
      }[]
    >([]);
  const request = useCallback(
    async <T,>(
      path: string,
      method = "GET",
      body?: unknown,
      override?: string,
    ): Promise<T> => {
      const r = await fetch(`/terminal-api${path}`, {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${override ?? token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok)
        throw new Error(
          r.status === 401
            ? "Access key was not accepted."
            : r.status === 400
              ? "Check the input values and available market data."
              : r.status === 429
                ? "Too many requests. Try again shortly."
                : "Service unavailable. Check API, database, or Alpaca configuration.",
        );
      return (await r.json()) as T;
    },
    [token],
  );
  const refresh = useCallback(async () => {
    const next = await request<Overview>("/overview");
    setData(next);
  }, [request]);
  useEffect(() => {
    if (!token) return;
    let active = true,
      fetching = false,
      next = 1000,
      last = 0;
    let socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (!active || fetching || Date.now() - last < 3000) return;
      last = Date.now();
      fetching = true;
      void request<Overview>("/overview")
        .then((d) => {
          if (active) {
            setData(d);
            setError((e) =>
              e === "Connection interrupted. Account state is unavailable."
                ? ""
                : e,
            );
          }
        })
        .catch(() => {
          if (active) {
            setData(undefined);
            setError("Connection interrupted. Account state is unavailable.");
          }
        })
        .finally(() => {
          fetching = false;
        });
    };
    function open() {
      if (!active) return;
      const url = new URL("/terminal-api/events", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => socket?.send(`Bearer ${token}`);
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "system.resync") {
            setSocketReady(true);
            next = 1000;
            sync();
          } else if (
            typeof msg.event === "string" &&
            !msg.event.startsWith("market.")
          )
            sync();
        } catch {
          /* Polling remains authoritative. */
        }
      };
      socket.onclose = () => {
        if (!active) return;
        setSocketReady(false);
        retry = setTimeout(open, next);
        next = Math.min(next * 2, 30000);
      };
    }
    open();
    const timer = setInterval(sync, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(retry);
      socket?.close();
      setSocketReady(false);
    };
  }, [token, request]);
  useEffect(() => {
    if (!token || !marketKey || tab !== "markets") return;
    let active = true;
    const update = () => {
      void request<typeof samples>(
        `/market-sample?${new URLSearchParams(marketKey)}`,
      )
        .then((x) => {
          if (active) setSamples(x);
        })
        .catch(() => {
          if (active) setSamples([]);
        });
    };
    update();
    const timer = setInterval(update, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, marketKey, tab, request]);
  function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    void action()
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Request failed."),
      )
      .finally(() => setBusy(false));
  }
  function select(next: typeof tab) {
    setTab(next);
    setError("");
    if (next === "analytics" && token)
      run(async () => setAnalytics(await request("/analytics")));
    if (next === "models" && token)
      run(async () => setRegistry(await request("/ai-models")));
  }
  function login(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const value = draft.trim();
      const next = await request<Overview>(
        "/overview",
        "GET",
        undefined,
        value,
      );
      setToken(value);
      setDraft("");
      setData(next);
      setConnect(false);
    });
  }
  function action(path: string, body: unknown, method = "POST") {
    run(async () => {
      await request(path, method, body);
      await refresh();
    });
  }
  const status = !data
      ? "Unverified"
      : data.state.stopped
        ? "Stopped"
        : "Armed",
    account = data?.broker?.account,
    positions = data?.broker?.positions;
  const workerOnline =
    data?.heartbeat && Date.now() - Date.parse(data.heartbeat.time) < 150000;
  const daily = account
    ? Number(account.equity) - Number(account.last_equity)
    : undefined;
  const query = new URLSearchParams({
    symbol: symbol.trim().toUpperCase(),
    assetClass,
    timeframe,
  });
  const title = nav.find((n) => n[1] === tab)![0];
  const fieldSet = (
    <>
      <label>
        Asset class
        <select value={assetClass} onChange={(e) => setClass(e.target.value)}>
          <option value="us_equity">US equities</option>
          <option value="crypto">Crypto</option>
        </select>
      </label>
      <label>
        Symbol
        <input
          placeholder={assetClass === "crypto" ? "BTC/USD" : "SPY"}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
        />
      </label>
      <label>
        Timeframe
        <select value={timeframe} onChange={(e) => setFrame(e.target.value)}>
          {frames.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
    </>
  );
  const strategyField = (
    <label>
      Strategy
      <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
        {strategies.map((s, i) => (
          <option key={s} value={s}>
            {strategyLabels[i]}
          </option>
        ))}
      </select>
    </label>
  );
  const orderTable = (items: Intent[] | undefined) => (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {["Symbol", "Side", "Quantity", "Filled", "Status", "Mode"].map(
              (x) => (
                <th key={x}>{x}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {items?.map((i) => (
            <tr key={i.id}>
              <td>{i.symbol}</td>
              <td>{i.side}</td>
              <td>{i.quantity}</td>
              <td>{i.filledQuantity}</td>
              <td>{i.status}</td>
              <td>
                <span className="pill">Paper</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items?.length && (
        <div className="empty small">
          {data
            ? "No paper orders recorded."
            : "Connect the terminal to view paper orders."}
        </div>
      )}
    </div>
  );
  const empty = (text: string) => <div className="empty">{text}</div>;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◩</span>
          <div>
            Tradient<small>TRADING TERMINAL</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace">
          {nav.map(([name, id], i) => (
            <button
              key={id}
              onClick={() => select(id)}
              className={tab === id ? "selected" : ""}
              aria-current={tab === id ? "page" : undefined}
            >
              <span>{glyphs[i]}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidefoot">
          <span className={`dot ${workerOnline ? "online" : ""}`} />
          <div>
            Worker status
            <small>
              {workerOnline ? "Heartbeat current" : "Heartbeat unavailable"}
            </small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="crumb">
            Workspace <span>/</span> {title}
          </div>
          <div className="header-actions">
            <span className="pill paper">
              <i className="dot online" /> PAPER MODE
            </span>
            {token ? (
              <button
                className="btn"
                onClick={() => {
                  setToken("");
                  setData(undefined);
                  setBars(undefined);
                  setAssets([]);
                  setResult(undefined);
                  setAnalysis(undefined);
                  setMarketKey(undefined);
                  setSamples([]);
                  setRegistry(undefined);
                  setAnalytics(undefined);
                  setEditing(undefined);
                }}
              >
                Disconnect
              </button>
            ) : (
              <button className="btn" onClick={() => setConnect(true)}>
                Connect terminal ↗
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <div className="pagehead">
            <div>
              <div className="eyebrow">ALPACA PAPER WORKSPACE</div>
              <h1>{tab === "overview" ? "Portfolio Overview" : title}</h1>
              <p>
                {
                  {
                    overview:
                      "Monitor your paper account, automation, and portfolio risk.",
                    markets:
                      "Discover tradable assets and inspect completed market candles.",
                    bots: "Configure independent technical strategies for paper trading.",
                    positions:
                      "Broker-reported inventory and unrealized performance.",
                    orders:
                      "Reconciled order intents and broker-reported fills.",
                    risk: "Review the trading circuit breaker and operating limits.",
                    backtest:
                      "Replay versioned strategies on historical market data.",
                    analysis:
                      "Request a structured interpretation of a recorded technical signal.",
                    models:
                      "Configure the Agnes primary model and optional OpenAI fallback.",
                    notifications:
                      "Recent worker, risk, and operator events from the audit log.",
                    settings: "Manage access to this single-operator terminal.",
                    strategies: "Choose a versioned strategy for a paper bot.",
                    analytics:
                      "Account equity changes, exposure and attributed paper fills.",
                  }[tab]
                }
              </p>
            </div>
            {tab === "overview" && (
              <button
                className="btn"
                disabled={!token || busy}
                onClick={() => run(refresh)}
              >
                ↻ Refresh
              </button>
            )}
          </div>
          {error && (
            <div className="notice danger" role="alert">
              {error}
            </div>
          )}
          {!token && (
            <div className="notice">
              <div>
                <b>Terminal is disconnected</b>
                <p>
                  Connect to the API to view your paper account and configure
                  automation.
                </p>
              </div>
              <button className="btn accent" onClick={() => setConnect(true)}>
                Connect terminal
              </button>
            </div>
          )}
          {token && data && !account && (
            <div className="notice danger">
              Alpaca account unavailable. Persisted records may still be
              visible.
            </div>
          )}
          {tab === "overview" && (
            <>
              <div className="metrics">
                {[
                  [
                    "Account equity",
                    money(account?.equity),
                    "Alpaca paper account",
                  ],
                  ["Daily change", money(daily), "vs. broker previous equity"],
                  [
                    "Buying power",
                    money(account?.buying_power),
                    "Broker-reported availability",
                  ],
                  [
                    "Open positions",
                    positions?.length ?? "—",
                    "Alpaca positions",
                  ],
                ].map(([label, value, sub]) => (
                  <article className="panel metric" key={label}>
                    <div>{label}</div>
                    <strong>{value}</strong>
                    <small>{sub}</small>
                  </article>
                ))}
              </div>
              <div className="grid">
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Portfolio equity</h2>
                      <p>Persisted account snapshots</p>
                    </div>
                    <span className="pill">USD</span>
                  </div>
                  {data?.equity.length ? (
                    <Chart points={data.equity} />
                  ) : (
                    <div className="empty chart-empty">
                      <span>⌁</span>No equity snapshots available
                      <small>
                        The worker records equity after a successful account
                        sync.
                      </small>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Risk status</h2>
                      <p>Account-wide controls</p>
                    </div>
                    <span className="pill">{status}</span>
                  </div>
                  <div className="riskrows">
                    <div>
                      <span>Execution mode</span>
                      <b>Paper only</b>
                    </div>
                    <div>
                      <span>Entry circuit breaker</span>
                      <b>{status}</b>
                    </div>
                    <div>
                      <span>Active bots</span>
                      <b>{data?.bots.filter((b) => b.enabled).length ?? "—"}</b>
                    </div>
                    <div>
                      <span>Worker heartbeat</span>
                      <b>{workerOnline ? "Current" : "Unavailable"}</b>
                    </div>
                    <button className="btn" onClick={() => select("risk")}>
                      Review risk controls →
                    </button>
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Recent paper orders</h2>
                    <p>Execution history</p>
                  </div>
                  <button className="btn" onClick={() => select("orders")}>
                    View orders →
                  </button>
                </div>
                {orderTable(data?.intents.slice(0, 6))}
              </section>
            </>
          )}
          {tab === "markets" && (
            <>
              <section className="panel pad">
                <form
                  className="formline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      setBars(await request(`/bars?${query}`));
                      setSamples([]);
                      setMarketKey({
                        symbol: query.get("symbol")!,
                        assetClass,
                      });
                    });
                  }}
                >
                  {fieldSet}
                  <button className="btn accent" disabled={!token || busy}>
                    Load chart
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!token || busy}
                    onClick={() =>
                      run(async () =>
                        setAssets(
                          await request(
                            `/assets?${new URLSearchParams({ assetClass, q: symbol })}`,
                          ),
                        ),
                      )
                    }
                  >
                    Discover assets
                  </button>
                </form>
                {assets.length > 0 && (
                  <div className="chips">
                    {assets.map((a) => (
                      <button
                        className="pill"
                        key={a.symbol}
                        onClick={() => {
                          setSymbol(a.symbol);
                          setClass(a.class);
                        }}
                      >
                        {a.symbol}
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Market candles</h2>
                    <p>{bars?.source ?? "Select an asset and timeframe"}</p>
                  </div>
                </div>
                {bars?.bars.length ? (
                  <Chart candles={bars.bars} />
                ) : (
                  empty("No market candles loaded.")
                )}
                {bars?.indicators && (
                  <div className="chips pad">
                    {[
                      "regime",
                      "e9",
                      "e21",
                      "rsi",
                      "atr",
                      "adx",
                      "vwap",
                      "ratio",
                    ].map((k) => (
                      <span className="pill" key={k}>
                        {k.toUpperCase()}{" "}
                        {typeof bars.indicators?.[k] === "number"
                          ? Number(bars.indicators[k]).toFixed(2)
                          : String(bars.indicators?.[k] ?? "—")}
                      </span>
                    ))}
                  </div>
                )}
              </section>
              {marketKey && (
                <section className="panel pad">
                  <h2>{marketKey.symbol} · Stream samples</h2>
                  {samples.length ? (
                    samples.map((s) => (
                      <div className="listrow" key={s.kind}>
                        <b>
                          {s.kind === "trade"
                            ? `Last trade ${money(s.payload.price)}`
                            : `Bid ${money(s.payload.bid)} / Ask ${money(s.payload.ask)}`}
                        </b>
                        <span>
                          {s.source} · {date(s.observedAt)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>
                      No fresh sample. The market stream tracks enabled bots and
                      depends on feed access.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
          {tab === "bots" && (
            <>
              <section className="panel pad">
                <h2>Create a bot</h2>
                <form
                  className="formline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action("/bots", {
                      symbol: symbol.trim().toUpperCase(),
                      assetClass,
                      timeframe,
                      strategy,
                    });
                  }}
                >
                  {fieldSet}
                  {strategyField}
                  <button className="btn accent" disabled={!token || busy}>
                    Create paused bot
                  </button>
                </form>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Configured bots</h2>
                </div>
                {!data?.bots.length
                  ? empty("No configured bots to display.")
                  : data.bots.map((b) => (
                      <div className="listrow" key={b.id}>
                        <div>
                          <b>{b.symbol}</b>
                          <p>
                            {strategyLabels[strategies.indexOf(b.strategy)]} ·{" "}
                            {b.timeframe}
                          </p>
                        </div>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() =>
                            action(
                              `/bots/${b.id}`,
                              { enabled: !b.enabled },
                              "PATCH",
                            )
                          }
                        >
                          {b.enabled ? "Pause" : "Enable"}
                        </button>
                      </div>
                    ))}
              </section>
            </>
          )}
          {tab === "orders" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Paper orders</h2>
              </div>
              {orderTable(data?.intents)}
            </section>
          )}
          {tab === "positions" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Open positions</h2>
              </div>
              {!positions?.length ? (
                empty(
                  positions
                    ? "No open positions."
                    : "Broker inventory unavailable.",
                )
              ) : (
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Quantity</th>
                        <th>Market value</th>
                        <th>Unrealized P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.symbol}>
                          <td>{p.symbol}</td>
                          <td>{p.qty}</td>
                          <td>{money(p.market_value)}</td>
                          <td>{money(p.unrealized_pl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {tab === "risk" && (
            <div className="grid">
              <section className="panel pad">
                <h2>Entry circuit breaker</h2>
                <p>
                  {data?.state.reason ??
                    "Current control state is unavailable."}
                </p>
                <div className="formline">
                  <button
                    className="btn stop"
                    disabled={!token || busy}
                    onClick={() => action("/control", { action: "stop" })}
                  >
                    Emergency stop
                  </button>
                </div>
                <p>
                  Stops new entries. The worker attempts eligible entry
                  cancellations and continues reconciliation. This does not
                  liquidate positions.
                </p>
                <form
                  className="formline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action("/control", {
                      action: "resume",
                      confirmation: confirm,
                    });
                    setConfirm("");
                  }}
                >
                  <label>
                    Type RESUME PAPER TRADING
                    <input
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn"
                    disabled={
                      !token || busy || confirm !== "RESUME PAPER TRADING"
                    }
                  >
                    Resume
                  </button>
                </form>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Operating limits</h2>
                </div>
                <div className="riskrows">
                  {[
                    ["Risk per entry", "0.5%"],
                    ["Position cap", "10%"],
                    ["Daily loss breaker", "2%"],
                    ["Weekly loss breaker", "4%"],
                    ["Account-wide position limit", "1"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Audit events</h2>
                </div>
                {!data?.audit.length
                  ? empty("No audit events to display.")
                  : data.audit.map((a) => (
                      <div className="listrow" key={a.id}>
                        <b>{a.event}</b>
                        <span>{date(a.time)}</span>
                      </div>
                    ))}
              </section>
            </div>
          )}
          {tab === "backtest" && (
            <>
              <section className="panel pad">
                <form
                  className="formline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () =>
                      setResult(
                        await request("/backtest", "POST", {
                          symbol: symbol.trim().toUpperCase(),
                          assetClass,
                          timeframe,
                          strategy,
                          start: f.get("start"),
                          end: f.get("end"),
                          capital: Number(f.get("capital")),
                        }),
                      ),
                    );
                  }}
                >
                  {fieldSet}
                  {strategyField}
                  <label>
                    Start
                    <input name="start" type="date" required />
                  </label>
                  <label>
                    End (exclusive)
                    <input name="end" type="date" required />
                  </label>
                  <label>
                    Starting capital
                    <input
                      name="capital"
                      type="number"
                      min="1"
                      defaultValue="10000"
                      required
                    />
                  </label>
                  <button className="btn accent" disabled={!token || busy}>
                    {busy ? "Working…" : "Run backtest"}
                  </button>
                </form>
                <p>
                  Single-asset simulation. Historical results do not predict
                  future performance.
                </p>
              </section>
              {result && (
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Simulation results</h2>
                      <p>
                        {result.version} · {result.source}
                      </p>
                    </div>
                  </div>
                  <div className="chips pad">
                    {[
                      ["Net return", pct(result.netReturn)],
                      ["Drawdown", pct(result.drawdown)],
                      ["Win rate", pct(result.winRate)],
                      ["Costs", money(result.costs)],
                      ["Trades", result.trades.length],
                    ].map(([k, v]) => (
                      <span className="pill" key={k}>
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                  <Chart points={result.curve} />
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Entry candle</th>
                          <th>Exit candle</th>
                          <th>Reason</th>
                          <th>Net P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t) => (
                          <tr key={t.entryTime}>
                            <td>{date(t.entryTime)}</td>
                            <td>{date(t.exitTime)}</td>
                            <td>{t.reason}</td>
                            <td>{money(t.pnl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
          {tab === "analysis" && (
            <>
              <section className="panel pad">
                <h2>Signal interpretation</h2>
                <p>
                  Analysis is informational and cannot approve or place orders.
                </p>
                <form
                  className="formline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () =>
                      setAnalysis(
                        await request("/analysis", "POST", { id: signalId }),
                      ),
                    );
                  }}
                >
                  <label>
                    Recorded signal
                    <select
                      value={signalId}
                      onChange={(e) => setSignalId(e.target.value)}
                      required
                    >
                      <option value="">Select a signal</option>
                      {data?.signals.map((s) => (
                        <option key={s.id} value={s.id}>
                          {data.bots.find((b) => b.id === s.botId)?.symbol} ·{" "}
                          {s.score}/100 · {s.decision} · {date(s.candle)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn accent"
                    disabled={!token || busy || !signalId}
                  >
                    Analyze signal
                  </button>
                </form>
              </section>
              {analysis && (
                <section className="panel pad">
                  <h2>
                    {analysis.analysis.marketRegime} ·{" "}
                    {analysis.analysis.recommendation}
                  </h2>
                  <p>
                    {analysis.model} · Model confidence{" "}
                    {pct(analysis.analysis.confidence)} (not a probability of
                    profit)
                  </p>
                  {(
                    ["reasoning", "risks", "invalidationConditions"] as const
                  ).map((k) => (
                    <div key={k}>
                      <h3>
                        {
                          {
                            reasoning: "Reasoning",
                            risks: "Risks",
                            invalidationConditions: "Invalidation conditions",
                          }[k]
                        }
                      </h3>
                      <ul>
                        {analysis.analysis[k].map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {tab === "models" && (
            <>
              <section className="panel pad">
                <h2>{editing ? "Edit model" : "Add model"}</h2>
                <p>
                  Enter prices from your provider contract. The API uses them
                  for estimated budget admission; provider billing can differ.
                </p>
                <form
                  className="formline"
                  key={editing?.id ?? "new"}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form),
                      key = String(f.get("key") ?? "");
                    run(async () => {
                      await request("/ai-models", "POST", {
                        provider: modelProvider,
                        name: f.get("name"),
                        role: f.get("role"),
                        enabled: f.get("enabled") === "on",
                        key: key || undefined,
                        maxTokens: Number(f.get("maxTokens")),
                        timeoutMs: Number(f.get("timeout")),
                        inputUsdPerMillion: f.get("inputPrice"),
                        outputUsdPerMillion: f.get("outputPrice"),
                      });
                      form.reset();
                      setEditing(undefined);
                      setRegistry(await request("/ai-models"));
                    });
                  }}
                >
                  <label>
                    Provider
                    <select
                      value={modelProvider}
                      disabled={!!editing}
                      onChange={(e) => setModelProvider(e.target.value)}
                    >
                      <option value="agnes">Agnes</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </label>
                  <label>
                    Provider model ID
                    <input
                      name="name"
                      placeholder="agnes-2.5-flash"
                      defaultValue={editing?.name}
                      readOnly={!!editing}
                      required
                    />
                  </label>
                  <label>
                    Assignment
                    <select
                      name="role"
                      key={modelProvider}
                      defaultValue={
                        editing?.role ??
                        (modelProvider === "agnes" ? "primary" : "fallback")
                      }
                    >
                      <option
                        value={
                          modelProvider === "agnes" ? "primary" : "fallback"
                        }
                      >
                        {modelProvider === "agnes" ? "Primary" : "Fallback"}
                      </option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <label>
                    Provider secret
                    <input
                      type="password"
                      name="key"
                      autoComplete="new-password"
                      placeholder={editing ? "Blank keeps existing secret" : ""}
                      required={!editing}
                    />
                  </label>
                  <label>
                    Output token limit
                    <input
                      name="maxTokens"
                      type="number"
                      min="100"
                      max="1024"
                      defaultValue={editing?.maxTokens ?? 650}
                      required
                    />
                  </label>
                  <label>
                    Timeout (ms)
                    <input
                      name="timeout"
                      type="number"
                      min="1000"
                      max="20000"
                      defaultValue={editing?.timeoutMs ?? 12000}
                      required
                    />
                  </label>
                  <label>
                    Input USD / million
                    <input
                      name="inputPrice"
                      inputMode="decimal"
                      defaultValue={editing?.inputUsdPerMillion}
                      required
                    />
                  </label>
                  <label>
                    Output USD / million
                    <input
                      name="outputPrice"
                      inputMode="decimal"
                      defaultValue={editing?.outputUsdPerMillion}
                      required
                    />
                  </label>
                  <label>
                    Enabled
                    <input
                      name="enabled"
                      type="checkbox"
                      defaultChecked={editing?.enabled ?? false}
                    />
                  </label>
                  <button className="btn accent" disabled={!token || busy}>
                    Save settings
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setEditing(undefined)}
                    >
                      Cancel edit
                    </button>
                  )}
                </form>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Model registry</h2>
                  <button
                    className="btn"
                    disabled={!token || busy}
                    onClick={() =>
                      run(async () => setRegistry(await request("/ai-models")))
                    }
                  >
                    Refresh
                  </button>
                </div>
                {registry?.models.length
                  ? registry.models.map((m) => (
                      <div className="listrow" key={m.id}>
                        <div>
                          <b>{m.name}</b>
                          <p>
                            {m.provider} · {m.role} ·{" "}
                            {m.enabled ? "Enabled" : "Disabled"}
                          </p>
                        </div>
                        <button
                          className="btn"
                          onClick={() => {
                            setEditing(m);
                            setModelProvider(m.provider);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    ))
                  : empty("No models to display.")}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Recent AI requests</h2>
                </div>
                {registry?.usage.length
                  ? registry.usage.map((u) => (
                      <div className="listrow" key={u.id}>
                        <div>
                          <b>
                            {u.model} · {u.status}
                          </b>
                          <p>{date(u.createdAt)}</p>
                        </div>
                        <span>
                          Estimated ${Number(u.estimatedUsd).toFixed(5)}
                        </span>
                      </div>
                    ))
                  : empty("No AI usage to display.")}
              </section>
            </>
          )}
          {tab === "notifications" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Operations events</h2>
              </div>
              {!data?.audit.length
                ? empty("No operations events to display.")
                : data.audit.map((a) => (
                    <div className="listrow" key={a.id}>
                      <b>{a.event}</b>
                      <span>{date(a.time)}</span>
                    </div>
                  ))}
            </section>
          )}
          {tab === "strategies" && (
            <section className="panel">
              <div className="panel-head">
                <h2>Technical strategy catalog</h2>
                <span className="pill">technical-v1</span>
              </div>
              {strategies.map((s, i) => (
                <div className="listrow" key={s}>
                  <b>{strategyLabels[i]}</b>
                  <button
                    className="btn"
                    onClick={() => {
                      setStrategy(s);
                      select("bots");
                    }}
                  >
                    Configure bot
                  </button>
                </div>
              ))}
            </section>
          )}
          {tab === "analytics" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Account analytics</h2>
                  <p>
                    Equity changes use the first saved snapshot in each UTC
                    period.
                  </p>
                </div>
                <button
                  className="btn"
                  disabled={!token || busy}
                  onClick={() =>
                    run(async () => setAnalytics(await request("/analytics")))
                  }
                >
                  Refresh
                </button>
              </div>
              {analytics ? (
                <div className="riskrows">
                  {[
                    ["Weekly change", analytics.weekly?.change],
                    ["Monthly change", analytics.monthly?.change],
                    [
                      "Attributed realized P&L (gross, before fees)",
                      analytics.realizedGross ?? undefined,
                    ],
                    ["Broker unrealized P&L", analytics.unrealized],
                    ["Gross exposure", analytics.grossExposure],
                    ["Crypto exposure", analytics.cryptoExposure],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <b>{money(value)}</b>
                    </div>
                  ))}
                  {analytics.weekly && (
                    <p>Weekly baseline: {date(analytics.weekly.baseline)}</p>
                  )}
                  {analytics.monthly && (
                    <p>Monthly baseline: {date(analytics.monthly.baseline)}</p>
                  )}
                </div>
              ) : (
                empty("Account analytics unavailable.")
              )}
            </section>
          )}
          {tab === "settings" && (
            <section className="panel pad">
              <h2>Terminal access</h2>
              <p>
                Updates:{" "}
                {socketReady ? "WebSocket connected" : "REST polling fallback"}.
              </p>
              <p>
                The operator key is kept in memory for the current page. Broker
                and provider credentials are configured server-side. Execution
                is restricted to Alpaca paper trading.
              </p>
              {!token && (
                <button className="btn" onClick={() => setConnect(true)}>
                  Connect terminal
                </button>
              )}
            </section>
          )}
          <footer>
            <span>Tradient · Paper trading only</span>
            <span>
              Simulated performance is not a guarantee of future results.
            </span>
          </footer>
        </div>
      </main>
      {connect && (
        <div className="overlay">
          <section
            className="panel dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
          >
            <h2 id="connect-title">Connect terminal</h2>
            <p>
              Use the operator key configured on your Tradient API. Do not enter
              your Alpaca credentials here.
            </p>
            {error && (
              <div role="alert" className="notice danger">
                {error}
              </div>
            )}
            <form onSubmit={login}>
              <label>
                Operator key
                <input
                  autoFocus
                  type="password"
                  autoComplete="off"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  required
                />
              </label>
              <div className="formline">
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setConnect(false);
                    setDraft("");
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button className="btn accent" disabled={busy}>
                  Connect
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
