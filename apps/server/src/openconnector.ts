import type {
	OpenConnectorActionMeta,
	OpenConnectorConnectionMeta,
	OpenConnectorProviderMeta,
	OpenConnectorService,
} from "@better-agent/agent/tool/openconnector-tools";
import type { ExecuteResult } from "@better-agent/agent/tool/types";
import { log } from "evlog";

// open-connector goes over the network; cap every call so a slow/unreachable
// API fails fast instead of keeping client queries pending forever.
const REQUEST_TIMEOUT_MS = 15_000;
// Listing actions returns full input schemas per service — legitimately slower.
const LIST_TIMEOUT_MS = 30_000;
// Per-service action cap: cover a provider's useful surface without flooding
// the model's context with hundreds of action schemas.
const ACTIONS_PER_SERVICE = 30;

// Providers without any auth requirement advertise this pseudo auth type.
const NO_AUTH = "no_auth";

// Strip a single trailing slash so `${baseUrl}${path}` never double-slashes.
const TRAILING_SLASH = /\/$/;

/** A provider entry from `GET /v1/providers` (runtime envelope `data`). */
interface RawProvider {
	authTypes: string[];
	categories: Array<{ displayName: string; id: string }>;
	displayName: string;
	homepageUrl?: string | null;
	iconUrl?: string | null;
	service: string;
}

/** A connection entry from `GET /api/connections` (admin raw array). */
interface RawConnection {
	authType: string;
	configured?: boolean;
	connectionName: string;
	default?: boolean;
	id: string;
	profile?: unknown;
	service: string;
	virtual?: boolean;
}

/** An action entry from `GET /v1/actions` (runtime envelope `data`). */
interface RawAction {
	description?: string;
	id: string;
	inputSchema?: Record<string, unknown>;
	name: string;
	service: string;
}

/** The `/v1/*` runtime response envelope. */
interface RuntimeEnvelope<T> {
	data?: T;
	errorCode?: string;
	message?: string;
	meta?: unknown;
	success: boolean;
}

/** The `{ error: { code, message } }` shape `/api/*` returns on failure. */
interface AdminError {
	error?: { code?: string; message?: string };
}

export function mapProvider(p: RawProvider): OpenConnectorProviderMeta {
	return {
		service: p.service,
		displayName: p.displayName,
		iconUrl: p.iconUrl ?? null,
		categories: p.categories.map((c) => c.displayName),
		authTypes: p.authTypes,
		needsAuth: !p.authTypes.includes(NO_AUTH),
	};
}

export function mapConnection(c: RawConnection): OpenConnectorConnectionMeta {
	return {
		id: c.id,
		service: c.service,
		connectionName: c.connectionName,
		authType: c.authType,
		configured: !!c.configured,
		virtual: !!c.virtual,
	};
}

export function mapAction(a: RawAction): OpenConnectorActionMeta {
	return {
		id: a.id,
		service: a.service,
		name: a.name,
		description: a.description ?? "",
		inputSchema: a.inputSchema ?? {},
	};
}

export function toExecuteResult(
	envelope: RuntimeEnvelope<unknown>
): ExecuteResult {
	if (envelope.success) {
		return { output: JSON.stringify(envelope.data ?? null), isError: false };
	}
	return {
		output: envelope.message ?? envelope.errorCode ?? "execution failed",
		isError: true,
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface ServiceConfig {
	adminToken: string;
	baseUrl: string;
	fetchImpl: typeof fetch;
	runtimeToken: string;
}

interface ReqOpts {
	body?: unknown;
	method: string;
	path: string;
	timeoutMs?: number;
}

async function rawFetch(
	cfg: ServiceConfig,
	token: string,
	opts: ReqOpts
): Promise<{ json: unknown; ok: boolean; status: number }> {
	const hasBody = opts.body !== undefined;
	const res = await cfg.fetchImpl(`${cfg.baseUrl}${opts.path}`, {
		method: opts.method,
		headers: {
			authorization: `Bearer ${token}`,
			...(hasBody ? { "content-type": "application/json" } : {}),
		},
		body: hasBody ? JSON.stringify(opts.body) : undefined,
		signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
	});
	const json = await res.json().catch(() => null);
	return { json, ok: res.ok, status: res.status };
}

// `/api/*` returns raw JSON; a non-2xx or `.error` body is a failure.
async function adminRequest(
	cfg: ServiceConfig,
	opts: ReqOpts
): Promise<unknown> {
	const { json, ok } = await rawFetch(cfg, cfg.adminToken, opts);
	const err = (json as AdminError | null)?.error;
	if (!ok || err) {
		const detail = `${err?.code ?? "http_error"}: ${err?.message ?? "request failed"}`;
		log.error("openconnector", `${opts.method} ${opts.path} failed: ${detail}`);
		throw new Error(detail);
	}
	return json;
}

// `/v1/*` wraps every response; return the envelope without interpreting it.
async function runtimeEnvelope(
	cfg: ServiceConfig,
	opts: ReqOpts
): Promise<RuntimeEnvelope<unknown>> {
	const { json, status } = await rawFetch(cfg, cfg.runtimeToken, opts);
	// A non-envelope body (empty 401, HTML 502) loses its status otherwise —
	// keep it so callers can detect auth failures (401/unauthorized).
	return (json ?? {
		success: false,
		message: `empty response (HTTP ${status})`,
	}) as RuntimeEnvelope<unknown>;
}

async function runtimeRequest(
	cfg: ServiceConfig,
	opts: ReqOpts
): Promise<unknown> {
	const envelope = await runtimeEnvelope(cfg, opts);
	if (envelope.success === false) {
		const detail = `${envelope.errorCode ?? "error"}: ${envelope.message ?? "request failed"}`;
		log.error("openconnector", `${opts.method} ${opts.path} failed: ${detail}`);
		throw new Error(detail);
	}
	return envelope.data;
}

function buildCatalogMethods(
	cfg: ServiceConfig
): Pick<
	OpenConnectorService,
	"connectWithKey" | "disconnect" | "listConnections" | "listProviders"
> {
	return {
		async listProviders() {
			const data = (await runtimeRequest(cfg, {
				method: "GET",
				path: "/v1/providers",
			})) as RawProvider[] | null;
			return (data ?? []).map(mapProvider);
		},
		async listConnections() {
			const data = (await adminRequest(cfg, {
				method: "GET",
				path: "/api/connections",
			})) as RawConnection[] | null;
			return (data ?? []).map(mapConnection);
		},
		async connectWithKey({ service, authType, values }) {
			const summary = (await adminRequest(cfg, {
				method: "PUT",
				path: `/api/connections/${encodeURIComponent(service)}`,
				body: { authType, values },
			})) as { configured?: boolean } | null;
			return { configured: !!summary?.configured };
		},
		async disconnect(service) {
			await adminRequest(cfg, {
				method: "DELETE",
				path: `/api/connections/${encodeURIComponent(service)}`,
			});
		},
	};
}

function buildActionMethods(
	cfg: ServiceConfig
): Pick<OpenConnectorService, "execute" | "listActions"> {
	return {
		async listActions(services) {
			// No services → no actions, and crucially no network call.
			if (services.length === 0) {
				return [];
			}
			// allSettled, not all: one unreachable provider must not zero out the
			// actions of every other connected provider (runtimeRequest logs each).
			const perService = await Promise.allSettled(
				services.map(async (service) => {
					const data = (await runtimeRequest(cfg, {
						method: "GET",
						path: `/v1/actions?service=${encodeURIComponent(service)}`,
						timeoutMs: LIST_TIMEOUT_MS,
					})) as RawAction[] | null;
					return (data ?? []).slice(0, ACTIONS_PER_SERVICE).map(mapAction);
				})
			);
			return perService.flatMap((r) =>
				r.status === "fulfilled" ? r.value : []
			);
		},
		async execute({ actionId, args }) {
			try {
				const envelope = await runtimeEnvelope(cfg, {
					method: "POST",
					path: `/v1/actions/${encodeURIComponent(actionId)}`,
					body: { input: args ?? {} },
				});
				return toExecuteResult(envelope);
			} catch (error) {
				// execute never throws — map failures into the ExecuteResult.
				return { output: messageOf(error), isError: true };
			}
		},
	};
}

export function createOpenConnectorService(config: {
	adminToken: string;
	baseUrl: string;
	fetchImpl?: typeof fetch;
	runtimeToken: string;
}): OpenConnectorService {
	const cfg: ServiceConfig = {
		adminToken: config.adminToken,
		baseUrl: config.baseUrl.replace(TRAILING_SLASH, ""),
		fetchImpl: config.fetchImpl ?? globalThis.fetch,
		runtimeToken: config.runtimeToken,
	};
	return {
		...buildCatalogMethods(cfg),
		...buildActionMethods(cfg),
	};
}
