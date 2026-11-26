import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { Client } from "pg";
import { z } from "zod";

const notificationSchema = z.object({
  event: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  symbol: z.string().max(32).optional(),
  kind: z.enum(["trade", "quote"]).optional(),
});
export async function events(
  app: FastifyInstance,
  authorized: (value: string) => boolean,
  connection?: string,
) {
  await app.register(websocket, {
    options: { maxPayload: 1024, perMessageDeflate: false },
  });
  type Socket =
    typeof app.websocketServer.clients extends Set<infer T> ? T : never;
  const subscribers = new Map<Socket, boolean>();
  const broadcast = (body: string) => {
    for (const [socket, auth] of subscribers) {
      if (auth && socket.readyState === 1) {
        if (socket.bufferedAmount < 65536) socket.send(body);
        else socket.terminate();
      }
    }
  };
  app.get("/events", { websocket: true }, (socket) => {
    if (subscribers.size >= 30) {
      socket.close(1013, "Connection limit");
      return;
    }
    subscribers.set(socket, false);
    const timer = setTimeout(
      () => socket.close(1008, "Authentication required"),
      4000,
    );
    socket.once("message", (raw: { toString(): string }) => {
      if (!authorized(raw.toString())) {
        socket.close(1008, "Unauthorized");
        return;
      }
      clearTimeout(timer);
      subscribers.set(socket, true);
      socket.send('{"event":"system.resync"}');
      socket.on("message", () => socket.close(1008, "Read only"));
    });
    socket.on("error", () => socket.terminate());
    socket.once("close", () => {
      clearTimeout(timer);
      subscribers.delete(socket);
    });
  });
  let stopped = false,
    client: Client | undefined,
    retry: NodeJS.Timeout | undefined,
    failures = 0;
  async function listen() {
    if (!connection || stopped) return;
    const local = new Client({
      connectionString: connection,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
    });
    client = local;
    const lost = () => {
      if (client !== local || stopped) return;
      client = undefined;
      void local.end().catch(() => {});
      retry = setTimeout(
        () => void listen(),
        Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
      );
    };
    local.on("error", lost);
    local.on("end", lost);
    local.on("notification", (message) => {
      try {
        const data = notificationSchema.parse(
          JSON.parse(message.payload ?? ""),
        );
        broadcast(JSON.stringify(data));
      } catch {
        /* Invalid notifications cannot become client events. */
      }
    });
    try {
      await local.connect();
      await local.query("LISTEN tradient_events");
      failures = 0;
      broadcast('{"event":"system.resync"}');
    } catch {
      lost();
    }
  }
  app.addHook("onReady", async () => {
    await listen();
  });
  app.addHook("preClose", async () => {
    stopped = true;
    clearTimeout(retry);
    for (const socket of subscribers.keys()) socket.terminate();
    await client?.end().catch(() => {});
  });
}
