import { createNodeDb } from "@better-agent/db/node-db";
import { env } from "@better-agent/env/server";
import { serve } from "@hono/node-server";
import { initLogger, log } from "evlog";
import { buildApp } from "./app";
import { registerBridgeWsRoute } from "./bridge-ws";
import { registerComputerWsRoute } from "./computer-ws";
import { registerPtyWsRoutes } from "./pty-ws";
import { createS3Bucket } from "./s3-bucket";
import { buildServices } from "./services";
import { createVncRouteDeps, registerVncRoutes } from "./vnc-proxy";

initLogger({
	env: { service: "better-agent-server" },
});

const db = createNodeDb(env.DATABASE_URL);
// Attachments are stored in an S3-compatible bucket — the server runs as a
// plain Node process, so there's no native object-store binding to lean on.
const uploads =
	env.S3_ENDPOINT &&
	env.S3_BUCKET &&
	env.S3_ACCESS_KEY_ID &&
	env.S3_SECRET_ACCESS_KEY
		? createS3Bucket({
				endpoint: env.S3_ENDPOINT,
				bucket: env.S3_BUCKET,
				accessKeyId: env.S3_ACCESS_KEY_ID,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			})
		: undefined;
const services = buildServices(db, uploads);
const app = buildApp(services);
// Session-scoped VNC WebSocket proxy (video plane). Wired here, not in
// buildApp, so buildApp stays transport-agnostic while this Node entry injects
// the WS upgrade handler onto the http server below.
const { injectWebSocket, upgradeWebSocket } = registerVncRoutes(
	app,
	createVncRouteDeps(services)
);
// CLI<->server command/event duplex channel (R0-T1). Reuses the same
// `upgradeWebSocket` instance as the VNC routes above — see bridge-ws.ts's
// top comment for why a second `createNodeWebSocket({app})` isn't safe here.
registerBridgeWsRoute(app, upgradeWebSocket, services);
// Computer control channel (S2-T2, D4): launch delivery to client-mode CLIs.
registerComputerWsRoute(app, upgradeWebSocket, services);
// P2-1 PTY byte-relay plane: CLI daemon (/pty/agent-ws) <-> web viewers
// (/pty/viewer-ws), pure sessionId-routed binary relay through services.ptyRelay.
registerPtyWsRoutes(app, upgradeWebSocket, services);

const server = serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		log.info("server", `Server is running on http://localhost:${info.port}`);
	}
);
injectWebSocket(server);
