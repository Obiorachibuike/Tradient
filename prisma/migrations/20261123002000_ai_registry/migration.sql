CREATE TABLE "AIModel" (
  "id" TEXT PRIMARY KEY, "provider" TEXT NOT NULL, "name" TEXT NOT NULL, "role" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "secretCipher" TEXT NOT NULL, "maxTokens" INTEGER NOT NULL,
  "timeoutMs" INTEGER NOT NULL, "inputUsdPerMillion" DECIMAL(15,6) NOT NULL,
  "outputUsdPerMillion" DECIMAL(15,6) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AIModel_provider_name_key" ON "AIModel"("provider", "name");
CREATE TABLE "AIUsage" (
  "id" TEXT PRIMARY KEY, "provider" TEXT NOT NULL, "model" TEXT NOT NULL, "status" TEXT NOT NULL,
  "inputTokens" INTEGER, "outputTokens" INTEGER, "estimatedUsd" DECIMAL(18,8) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");
