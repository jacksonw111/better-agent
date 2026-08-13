import { createNodeDb } from "@better-agent/db/node-db";
import { env } from "@better-agent/env/server";
import { serve } from "@hono/node-server";
import { initLogger, log } from "evlog";
import { buildApp } from "./app";
import { createS3Bucket } from "./s3-bucket";
import { buildServices } from "./services";

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

serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		log.info("server", `Server is running on http://localhost:${info.port}`);
	}
);
