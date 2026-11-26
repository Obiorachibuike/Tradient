CREATE TABLE "MarketEvent" (
  "symbol" TEXT NOT NULL, "source" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL, "payload" JSONB NOT NULL,
  PRIMARY KEY ("symbol", "source", "kind")
);

-- Notifications are transient invalidations, not a substitute for persisted state.
CREATE FUNCTION tradient_notify() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'EquitySnapshot' THEN event_name := 'portfolio.updated';
    WHEN 'Bot' THEN event_name := 'bot.status.changed';
    WHEN 'Intent' THEN
      IF TG_OP = 'UPDATE' AND NEW.status = OLD.status AND NEW."filledQuantity" = OLD."filledQuantity" THEN RETURN NEW; END IF;
      event_name := CASE NEW.status WHEN 'filled' THEN 'order.filled' WHEN 'partially_filled' THEN 'order.partially_filled'
          WHEN 'canceled' THEN 'order.cancelled' WHEN 'accepted' THEN 'order.submitted' WHEN 'new' THEN 'order.submitted' ELSE 'order.updated' END;
    WHEN 'Signal' THEN
      event_name := CASE NEW.decision WHEN 'approved' THEN 'signal.approved' WHEN 'risk-rejected' THEN 'signal.rejected' ELSE 'signal.generated' END;
    WHEN 'Control' THEN event_name := 'risk.status.changed';
    WHEN 'Audit' THEN
      event_name := CASE NEW.event WHEN 'worker.error' THEN 'system.error' WHEN 'ai.analysis' THEN 'ai.analysis.completed' WHEN 'risk.stop' THEN 'risk.limit.triggered' ELSE 'audit.updated' END;
    WHEN 'MarketEvent' THEN
      PERFORM pg_notify('tradient_events', json_build_object('event','market.price.updated','symbol',NEW.symbol,'kind',NEW.kind)::text);
      RETURN NEW;
    WHEN 'MarketBar' THEN
      PERFORM pg_notify('tradient_events', json_build_object('event','market.candle.closed','symbol',NEW.symbol)::text);
      RETURN NEW;
    ELSE RETURN NEW;
  END CASE;
  PERFORM pg_notify('tradient_events', json_build_object('event',event_name)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER tradient_equity AFTER INSERT ON "EquitySnapshot" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_bot AFTER INSERT OR UPDATE ON "Bot" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_order AFTER INSERT OR UPDATE ON "Intent" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_signal AFTER INSERT ON "Signal" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_control AFTER INSERT OR UPDATE ON "Control" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_audit AFTER INSERT ON "Audit" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_market_event AFTER INSERT OR UPDATE ON "MarketEvent" FOR EACH ROW EXECUTE FUNCTION tradient_notify();
CREATE TRIGGER tradient_market_bar AFTER INSERT ON "MarketBar" FOR EACH ROW WHEN (NEW.source LIKE '%-stream') EXECUTE FUNCTION tradient_notify();
