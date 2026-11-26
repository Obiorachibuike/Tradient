ALTER TABLE "Intent" ADD COLUMN "signalId" TEXT, ADD COLUMN "parentId" TEXT;
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Intent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Intent_signalId_key" ON "Intent"("signalId");
CREATE INDEX "Intent_parentId_idx" ON "Intent"("parentId");
