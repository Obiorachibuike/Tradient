CREATE TABLE "Control" (
  "id" INTEGER PRIMARY KEY, "stopped" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT NOT NULL DEFAULT 'Not armed', "changedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Bot" (
  "id" TEXT PRIMARY KEY, "symbol" TEXT NOT NULL, "assetClass" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL, "strategy" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Signal" (
  "id" TEXT PRIMARY KEY, "botId" TEXT NOT NULL, "candle" TIMESTAMP(3) NOT NULL,
  "version" TEXT NOT NULL, "readings" JSONB NOT NULL, "score" INTEGER NOT NULL, "decision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Signal_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Signal_botId_candle_key" ON "Signal"("botId", "candle");
CREATE TABLE "Intent" (
  "id" TEXT PRIMARY KEY, "symbol" TEXT NOT NULL, "assetClass" TEXT NOT NULL, "side" TEXT NOT NULL,
  "quantity" DECIMAL(30,12) NOT NULL, "limitPrice" DECIMAL(30,12) NOT NULL,
  "stop" DECIMAL(30,12), "target" DECIMAL(30,12), "status" TEXT NOT NULL, "brokerId" TEXT,
  "filledQuantity" DECIMAL(30,12) NOT NULL DEFAULT 0, "averageFill" DECIMAL(30,12),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Intent_brokerId_key" ON "Intent"("brokerId");
CREATE INDEX "Intent_status_side_idx" ON "Intent"("status", "side");
CREATE INDEX "Intent_symbol_createdAt_idx" ON "Intent"("symbol", "createdAt");
CREATE TABLE "MarketBar" (
  "symbol" TEXT NOT NULL, "source" TEXT NOT NULL, "timeframe" TEXT NOT NULL, "time" TIMESTAMP(3) NOT NULL,
  "open" DOUBLE PRECISION NOT NULL, "high" DOUBLE PRECISION NOT NULL, "low" DOUBLE PRECISION NOT NULL,
  "close" DOUBLE PRECISION NOT NULL, "volume" DOUBLE PRECISION NOT NULL,
  PRIMARY KEY ("symbol", "source", "timeframe", "time")
);
CREATE TABLE "EquitySnapshot" (
  "time" TIMESTAMP(3) PRIMARY KEY DEFAULT CURRENT_TIMESTAMP, "accountId" TEXT NOT NULL,
  "equity" DECIMAL(30,12) NOT NULL, "buyingPower" DECIMAL(30,12) NOT NULL
);
CREATE INDEX "EquitySnapshot_accountId_time_idx" ON "EquitySnapshot"("accountId", "time");
CREATE TABLE "Heartbeat" ("id" TEXT PRIMARY KEY, "time" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Audit" (
  "id" TEXT PRIMARY KEY, "event" TEXT NOT NULL, "detail" JSONB NOT NULL,
  "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Audit_time_idx" ON "Audit"("time");
CREATE TABLE "BacktestRun" (
  "id" TEXT PRIMARY KEY, "config" JSONB NOT NULL, "result" JSONB NOT NULL,
  "source" TEXT NOT NULL, "version" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BacktestRun_createdAt_idx" ON "BacktestRun"("createdAt");
