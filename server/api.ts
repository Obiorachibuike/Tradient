import { db } from "./db";
import { createApi } from "./http";
async function main() {
  const app = await createApi(
    process.env.ADMIN_TOKEN,
    undefined,
    process.env.DATABASE_URL,
  );
  await app.listen({
    host: "0.0.0.0",
    port: Number(process.env.API_PORT ?? 4000),
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.once(sig, () => {
      void app.close().then(() => db.$disconnect());
    });
}
main().catch(() => {
  console.error("API startup failed. Check configuration and port.");
  process.exitCode = 1;
});
