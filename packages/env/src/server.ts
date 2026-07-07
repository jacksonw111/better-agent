import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		/** 逗号分隔的允许来源（支持 web 3001 + admin 3002 等多个 dev 前端）。 */
		CORS_ORIGIN: z
			.string()
			.min(1)
			.transform((value) => value.split(",").map((origin) => origin.trim()))
			.pipe(z.array(z.url())),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		CREDENTIALS_SECRET: z.string().min(32),
		AUTH_JWT_SECRET: z.string().min(32),
		REDIS_URL: z.string().optional(),
		/** Upstash Redis REST — used on Cloudflare Workers (HTTP, cross-isolate)
		 * to coordinate client/remote tool-call results. Both must be set. */
		UPSTASH_REDIS_REST_URL: z.string().optional(),
		UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
		/** S3-compatible attachment storage (k3s/prod; Workers uses the R2
		 * binding instead). All four must be set together. */
		S3_ENDPOINT: z.string().optional(),
		S3_BUCKET: z.string().optional(),
		S3_ACCESS_KEY_ID: z.string().optional(),
		S3_SECRET_ACCESS_KEY: z.string().optional(),
		RESEND_API_KEY: z.string().optional(),
		AUTH_EMAIL_FROM: z.string().default("noreply@trendf.top"),
		WEB_URL: z.url().default("http://localhost:3001"),
		ADMIN_URL: z.url().default("http://localhost:3002"),
		ADMIN_EMAILS: z
			.string()
			.default("")
			.transform((value) =>
				value
					.split(",")
					.map((e) => e.trim().toLowerCase())
					.filter((e) => e !== "")
			),
		COMPOSIO_API_KEY: z.string().optional(),
		/** 逗号分隔的 composio toolkit slugs（默认 hackernews：免授权，可只用 app key 冒烟）。 */
		COMPOSIO_TOOLKITS: z
			.string()
			.default("hackernews")
			.transform((value) =>
				value
					.split(",")
					.map((s) => s.trim().toLowerCase())
					.filter((s) => s !== "")
			),
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		/** SiliconFlow (OpenAI-compatible) embeddings — powers memory embeddings
		 * (decision D1, `BAAI/bge-m3`, 1024 dims). Optional so non-embedding
		 * runtimes and tests validate; the client throws a clear error if a call
		 * is made without the key. BASE_URL / model default when unset. */
		SILICONFLOW_API_KEY: z.string().optional(),
		SILICONFLOW_BASE_URL: z.string().optional(),
		EMBEDDING_MODEL: z.string().optional(),
		/** Standalone authz (invite) service — the gate is off when unset. */
		AUTHZ_URL: z.string().optional(),
		AUTHZ_SERVICE_SECRET: z.string().optional(),
		MODELS_DEV_URL: z.url().default("https://models.dev/api.json"),
		/** 逗号分隔的「只同步这些 provider」白名单（避免把 models.dev 全部 145 个 provider 同步进来）。 */
		CATALOG_PROVIDERS: z
			.string()
			.default(
				"anthropic,openai,google,google-vertex,google-vertex-anthropic,xai,zai,zai-coding-plan,zhipuai,zhipuai-coding-plan,minimax,minimax-cn,minimax-cn-coding-plan,minimax-coding-plan,deepseek,openrouter,kimi-for-coding,moonshotai,moonshotai-cn"
			)
			.transform((value) =>
				value
					.split(",")
					.map((id) => id.trim())
					.filter((id) => id !== "")
			),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
