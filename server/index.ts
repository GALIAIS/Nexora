import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import type { ControlPayload, GameSnapshot, SettingsPayload } from "../shared/types";
import { API_REFERENCE, MAX_TICK_RATE, MIN_TICK_RATE } from "./game/constants";
import { GameService } from "./game/service";
import { AutomationReplicationEncoder } from "./game/replication";

const PORT = Number(process.env.PORT ?? 4100);
const HOST = process.env.HOST ?? "127.0.0.1";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIST = join(ROOT, "dist", "client");

const service = await GameService.create();
const replication = new AutomationReplicationEncoder(service.getSnapshot());
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, tick: service.getSnapshot().state.tick });
});

app.get("/api/state", (_request, response) => {
  response.json(service.getSnapshot());
});

app.get("/api/code", (_request, response) => {
  response.json(service.getCode());
});

app.put("/api/code", async (request, response) => {
  const code = request.body?.code;
  if (typeof code !== "string" || code.length > 200_000) {
    response.status(400).json({ error: "code must be a string smaller than 200 KB" });
    return;
  }
  try {
    response.json(await service.updateCode(code));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/control", async (request, response) => {
  const command = request.body?.command as ControlPayload["command"] | undefined;
  if (!command || !["start", "pause", "step", "reset"].includes(command)) {
    response.status(400).json({ error: "invalid control command" });
    return;
  }
  response.json(await service.control(command));
});

app.patch("/api/settings", async (request, response) => {
  const tickRate = Number(request.body?.tickRate as SettingsPayload["tickRate"]);
  if (!Number.isFinite(tickRate) || tickRate < MIN_TICK_RATE || tickRate > MAX_TICK_RATE) {
    response.status(400).json({ error: `tickRate must be between ${MIN_TICK_RATE} and ${MAX_TICK_RATE}` });
    return;
  }
  response.json(await service.updateSettings({ tickRate }));
});

app.get("/api/reference", (_request, response) => {
  response.json(API_REFERENCE);
});

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/.*/, (_request, response) => {
    response.sendFile(join(CLIENT_DIST, "index.html"));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "internal server error" });
});

const server = createServer(app);
const socketServer = new WebSocketServer({ server, path: "/socket" });

socketServer.on("connection", (socket) => {
  socket.send(JSON.stringify(replication.currentKeyframe()));
});

service.on("snapshot", (snapshot: GameSnapshot) => {
  const payload = JSON.stringify(replication.encode(snapshot));
  for (const client of socketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nexora server listening on http://${HOST}:${PORT}`);
});

const shutdown = async () => {
  await service.shutdown();
  socketServer.close();
  server.close(() => process.exit(0));
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
