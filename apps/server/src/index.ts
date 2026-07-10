import { createNodeDb } from "@better-agent/db/node-db";
import { env } from "@better-agent/env/server";
import { serve } from "@hono/node-server";
import { initLogger, log } from "evlog";
import { buildApp } from "./app";
import { createS3Bucket } from "./s3-bucket";
import { buildServices } from "./services";
import { createVncRouteDeps, registerVncRoutes } from "./vnc-proxy";

initLogger({
	env: { service: "better-agent-server" },
});

const db = createNodeDb(env.DATABASE_URL);
// Attachments on non-Workers runtimes go through the S3 protocol (same R2
// bucket the Workers deployment reaches via its native binding).
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
const services = buildServices(db, undefined, uploads);
const app = buildApp(services);
// Session-scoped VNC WebSocket proxy (video plane). Wired here, not in
// buildApp, because buildApp is shared with the Workers entry (worker.ts),
// where long-lived WebSockets aren't supported — only this Node/Docker
// deployment injects the WS upgrade handler onto the http server below.
const { injectWebSocket } = registerVncRoutes(
	app,
	createVncRouteDeps(services)
);

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
