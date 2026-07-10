/**
 * HTTP client for Cua's `lume` local VM manager (`lume serve`, default port
 * 7777). Wraps the `/lume/vms` REST surface documented at
 * https://cua.ai/docs/lume/reference/http-api. This module only talks to the
 * local lume daemon over HTTP — it does not itself start `lume serve` or
 * connect to a VM's computer-server (that's the cua execution handler, a
 * separate module).
 */

const DEFAULT_BASE_URL = "http://localhost:7777";
const REQUEST_TIMEOUT_MS = 10_000;

export interface LumeVm {
	ipAddress: string | null;
	name: string;
	status: string;
	vncUrl: string | null;
}

export interface LumeCreateInput {
	cpu?: number;
	diskSize?: string;
	display?: string;
	memory?: string;
	name: string;
	os?: string;
}

export interface LumeClient {
	create: (input: LumeCreateInput) => Promise<void>;
	get: (name: string) => Promise<LumeVm | null>;
	list: () => Promise<LumeVm[]>;
	run: (name: string) => Promise<void>;
	stop: (name: string) => Promise<void>;
}

export interface CreateLumeClientOptions {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}

/** Raw shape returned by the lume HTTP API for a VM. Field names vary
 * (`state` vs `status`) so callers should go through `mapVm`. */
interface RawLumeVm {
	ip_address?: unknown;
	ipAddress?: unknown;
	name?: unknown;
	state?: unknown;
	status?: unknown;
	vnc_url?: unknown;
	vncUrl?: unknown;
}

function asStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Normalizes a raw lume API VM record into the stable `LumeVm` shape,
 * tolerating either `status`/`state` and either camelCase or snake_case
 * field names for the VNC URL and IP address. */
export function mapVm(raw: unknown): LumeVm {
	const record: RawLumeVm = raw && typeof raw === "object" ? raw : {};
	const name = typeof record.name === "string" ? record.name : "";
	const status =
		asStringOrNull(record.status) ?? asStringOrNull(record.state) ?? "unknown";
	const vncUrl =
		asStringOrNull(record.vncUrl) ?? asStringOrNull(record.vnc_url);
	const ipAddress =
		asStringOrNull(record.ipAddress) ?? asStringOrNull(record.ip_address);
	return { name, status, vncUrl, ipAddress };
}

function stripTrailingSlash(url: string): string {
	return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildRequestError(
	method: string,
	path: string,
	status: number
): Error {
	return new Error(`lume request failed: ${method} ${path} -> ${status}`);
}

async function sendRequest(
	fetchImpl: typeof fetch,
	method: string,
	url: string,
	body?: unknown
): Promise<Response> {
	return await fetchImpl(url, {
		method,
		headers:
			body === undefined ? undefined : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
}

/** Posts to a VM lifecycle path (`run`/`stop`) with no body, tolerating any
 * 2xx status (`run` returns 202 Accepted since it's async). */
async function postLifecycleAction(
	fetchImpl: typeof fetch,
	baseUrl: string,
	path: string
): Promise<void> {
	const response = await sendRequest(fetchImpl, "POST", `${baseUrl}${path}`);
	if (!response.ok) {
		throw buildRequestError("POST", path, response.status);
	}
}

async function listVms(
	fetchImpl: typeof fetch,
	baseUrl: string
): Promise<LumeVm[]> {
	const path = "/lume/vms";
	const response = await sendRequest(fetchImpl, "GET", `${baseUrl}${path}`);
	if (!response.ok) {
		throw buildRequestError("GET", path, response.status);
	}
	const data: unknown = await response.json();
	const items = Array.isArray(data) ? data : [];
	return items.map(mapVm);
}

async function getVm(
	fetchImpl: typeof fetch,
	baseUrl: string,
	name: string
): Promise<LumeVm | null> {
	const path = `/lume/vms/${name}`;
	const response = await sendRequest(fetchImpl, "GET", `${baseUrl}${path}`);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw buildRequestError("GET", path, response.status);
	}
	const data: unknown = await response.json();
	return mapVm(data);
}

async function createVm(
	fetchImpl: typeof fetch,
	baseUrl: string,
	input: LumeCreateInput
): Promise<void> {
	const path = "/lume/vms";
	const response = await sendRequest(
		fetchImpl,
		"POST",
		`${baseUrl}${path}`,
		input
	);
	if (!response.ok) {
		throw buildRequestError("POST", path, response.status);
	}
}

/** Creates a client for the local `lume serve` HTTP API. `fetchImpl` can be
 * injected for testing; it defaults to the global `fetch`. */
export function createLumeClient(opts?: CreateLumeClientOptions): LumeClient {
	const baseUrl = stripTrailingSlash(opts?.baseUrl ?? DEFAULT_BASE_URL);
	const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;

	return {
		run: (name) =>
			postLifecycleAction(fetchImpl, baseUrl, `/lume/vms/${name}/run`),
		stop: (name) =>
			postLifecycleAction(fetchImpl, baseUrl, `/lume/vms/${name}/stop`),
		list: () => listVms(fetchImpl, baseUrl),
		get: (name) => getVm(fetchImpl, baseUrl, name),
		create: (input) => createVm(fetchImpl, baseUrl, input),
	};
}
