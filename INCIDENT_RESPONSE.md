# Incident response

1. Stop new entries in **Risk Management**. Confirm the terminal shows the persisted stopped state; if the API/database cannot confirm the stop, stop all order-producing workers at the host and use the Alpaca **paper** dashboard to inspect and cancel managed outstanding entries. A lost connection or killed worker alone does not cancel broker orders.
2. Preserve database and queue state. Review worker heartbeat, audit and `paper-tick-dead`. Verify orders, partial fills, available position quantities and account identity directly in Alpaca. Do not delete intents, restart with a new database, or reset account keys to bypass an unresolved order.
3. For `unknown`, search Alpaca by the persisted `client_order_id`. The worker looks up the order on every healthy cycle; when found it records broker state. If the broker returns no record, Tradient will not resubmit or release the block automatically. Escalate with broker support and reconcile manually before returning the deployment to operation. No integrated override is provided.
4. Keep monitoring open positions; software exits may be unavailable during the incident. No automatic liquidation is triggered by outage. Any manual paper exit must be inspected and reconciled before restarting automation.
5. After verifying balances, worker freshness, connectivity and order/position state, explicitly resume. A still-breached risk baseline may immediately stop entries again.

If a token is exposed, stop and rotate the operator key (restart API to invalidate old sessions/sockets), then rotate provider keys independently and verify account ID before resuming. Back up encrypted AI records and protect the corresponding master key separately. Do not send credentials in support tickets or logs.

## Future live-readiness checklist (not enabled)

Independent security review and penetration test; audited ownership and RBAC; validated execution simulations; financial/regulatory review; broker-native safety and reconciliation drills; explicit keys/account separation; cost and organizational authorization; monitored staged rollout and rollback. None of these changes is authorized by this paper release.
