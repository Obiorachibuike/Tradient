# Strategies and research

All bots use the `technical-v1` rules, one instrument per bot, independently selected timeframe and paused/enabled state. Supported intervals are 1m, 5m, 15m, 1h, 4h and 1d. Execution uses sorted REST candles with at least 200 observations, a conservative elapsed-interval check and an age limit. IEX and crypto data are never fused. Rolling 20-bar VWAP is not exchange-session VWAP.

| Strategy | Entry setup before scoring |
| --- | --- |
| EMA | EMA 9 > 21 > 50 and close above EMA 200 |
| RSI | RSI 14 between 55 and 68 |
| MACD | MACD histogram crosses above zero |
| Bollinger | Close below the lower 20-bar band and RSI below 35 |
| VWAP | Close above rolling VWAP with trend alignment |
| Breakout | Close above prior 20-bar highs plus elevated volume |
| Confluence | Trend + momentum + elevated volume |

Passing a setup is not enough. The deterministic score uses trend (25), momentum (20), volume (15), volatility suitability (10), regime (15) and reserved AI (15; zero in this release). Bollinger uses sideways alignment for its trend/regime components. Minimum is 75. The score is **not** a probability of profit. Strategy signals retain the version, source, readings, component scores, explanation and disposition. Advisory AI interpretation is separate and does not affect sizing, eligibility or execution.

## Backtests

A run uses historical Alpaca data, configured capital, versioned signals and a one-way cost in basis points. It uses candles preceding the entry and fills at the next candle open with costs, checks adverse gaps at open, resolves ambiguous stop/target collisions stop-first, and closes remaining inventory at the end. Results retain simulated trades, curve, costs, drawdown, returns, win rate, profit factor and expectancy. Historical runs are persisted with their configuration and source. Data is raw IEX/US crypto; splits, latency, simulated order book, fees by venue, market impact and cashflows are not modeled exactly. This release does not implement portfolio or point-in-time-universe simulation, walk-forward optimization, out-of-sample protocols or Monte Carlo. Do not tune on your only holdout sample or treat backtest outcomes as a guarantee.
