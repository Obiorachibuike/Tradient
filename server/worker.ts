import PgBoss from "pg-boss";
import { Alpaca } from "./alpaca";
import { db, control } from "./db";
import { tick } from "./trading";
import { startStreams } from "./streams";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const broker = new Alpaca(),
    account = await broker.account();
  if (
    account.status !== "ACTIVE" ||
    account.account_blocked ||
    account.trading_blocked
  )
    throw new Error("Paper account not active");
  const previous = await db.equitySnapshot.findFirst({
    orderBy: { time: "desc" },
  });
  if (previous && previous.accountId !== account.id)
    throw new Error("Account changed");
  await control();
  const boss = new PgBoss(process.env.DATABASE_URL);
  boss.on("error", () => console.error("Queue connection error"));
  await boss.start();
  try {
    await boss.createQueue("paper-tick-dead");
    await boss.createQueue("paper-tick", {
      name: "paper-tick",
      policy: "singleton",
      retryLimit: 0,
      expireInSeconds: 240,
      deadLetter: "paper-tick-dead",
    });
    await boss.work("paper-tick", async () => {
      try {
        // Different lock from the execution/control lock. Held for the entire broker snapshot/tick.
        await db.$transaction(
          async (tx) => {
            const locked = await tx.$queryRaw<
              { locked: boolean }[]
            >`SELECT pg_try_advisory_xact_lock(198523173) AS locked`;
            if (!locked[0]?.locked) return;
            await tick(broker);
            await db.heartbeat.upsert({
              where: { id: "trading" },
              create: { id: "trading" },
              update: { time: new Date() },
            });
          },
          { timeout: 200000 },
        );
      } catch (error) {
        console.error("Paper cycle failed");
        await db.audit
          .create({
            data: {
              event: "worker.error",
              detail: {
                message:
                  "Paper trading cycle failed; reconciliation required before new entries.",
              },
            },
          })
          .catch(() => {});
        throw error;
      }
    });
    // Every tick starts with reconciliation, including the first tick after process restart.
    await boss.schedule("paper-tick", "* * * * *");
    await boss.send("paper-tick", {});
    const stopStreams =
      process.env.ALPACA_STREAMS === "false"
        ? () => {}
        : startStreams(() => {
            void boss
              .send(
                "paper-tick",
                {},
                { singletonSeconds: 10, singletonKey: "trade-update" },
              )
              .catch(() =>
                console.error("Could not enqueue trade update wake-up"),
              );
          });
    let closing = false;
    for (const sig of ["SIGINT", "SIGTERM"] as const)
      process.once(sig, () => {
        if (closing) return;
        closing = true;
        stopStreams();
        void boss
          .stop({ graceful: true, timeout: 240000 })
          .then(() => db.$disconnect());
      });
  } catch (e) {
    await boss.stop();
    throw e;
  }
}
main().catch(async () => {
  console.error(
    "Worker startup failed. Check paper credentials and database connectivity.",
  );
  await db.$disconnect();
  process.exitCode = 1;
});
