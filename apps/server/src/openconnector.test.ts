import { describe, expect, it, vi } from "vitest";
import {
	createOpenConnectorService,
	mapAction,
	mapConnection,
	mapProvider,
	toExecuteResult,
} from "./openconnector";

describe("mapProvider", () => {
	it("flags a no_auth provider as not needing auth", () => {
		expect(
			mapProvider({
				service: "hackernews",
				displayName: "Hacker News",
				iconUrl: "https://icon",
				authTypes: ["no_auth"],
				categories: [{ id: "news", displayName: "News" }],
			})
		).toEqual({
			service: "hackernews",
			displayName: "Hacker News",
			iconUrl: "https://icon",
			categories: ["News"],
			authTypes: ["no_auth"],
			needsAuth: false,
		});
	});

	it("flags an oauth2 provider as needing auth and defaults a missing icon", () => {
		const meta = mapProvider({
			service: "github",
			displayName: "GitHub",
			authTypes: ["oauth2"],
			categories: [
				{ id: "dev", displayName: "Developer" },
				{ id: "vcs", displayName: "Version Control" },
			],
		});
		expect(meta.needsAuth).toBe(true);
		expect(meta.iconUrl).toBeNull();
		expect(meta.categories).toEqual(["Developer", "Version Control"]);
	});
});

describe("mapConnection", () => {
	it("maps a raw connection and coerces configured/virtual to boolean", () => {
		expect(
			mapConnection({
				id: "conn_1",
				service: "github",
				connectionName: "default",
				authType: "oauth2",
				configured: true,
				virtual: false,
				default: true,
				profile: { foo: "bar" },
			})
		).toEqual({
			id: "conn_1",
			service: "github",
			connectionName: "default",
			authType: "oauth2",
			configured: true,
			virtual: false,
		});
	});

	it("coerces missing configured/virtual to false", () => {
		const meta = mapConnection({
			id: "conn_2",
			service: "slack",
			connectionName: "team",
			authType: "api_key",
		});
		expect(meta.configured).toBe(false);
		expect(meta.virtual).toBe(false);
	});
});

describe("mapAction", () => {
	it("maps a raw action with its input schema", () => {
		expect(
			mapAction({
				id: "github.get_current_user",
				service: "github",
				name: "Get current user",
				description: "Returns the authenticated user",
				inputSchema: { type: "object", properties: {} },
			})
		).toEqual({
			id: "github.get_current_user",
			service: "github",
			name: "Get current user",
			description: "Returns the authenticated user",
			inputSchema: { type: "object", properties: {} },
		});
	});

	it("defaults a missing input schema to an empty object", () => {
		const meta = mapAction({
			id: "github.ping",
			service: "github",
			name: "Ping",
		});
		expect(meta.inputSchema).toEqual({});
		expect(meta.description).toBe("");
	});
});

describe("toExecuteResult", () => {
	it("maps a success envelope to a JSON output", () => {
		expect(toExecuteResult({ success: true, data: { login: "x" } })).toEqual({
			isError: false,
			output: '{"login":"x"}',
		});
	});

	it("serializes missing data as null", () => {
		expect(toExecuteResult({ success: true })).toEqual({
			isError: false,
			output: "null",
		});
	});

	it("maps a failure envelope to an isError output using the message", () => {
		const result = toExecuteResult({
			success: false,
			message: "boom",
			errorCode: "provider_error",
		});
		expect(result.isError).toBe(true);
		expect(result.output).toContain("boom");
	});
});

interface FakeCall {
	headers: Record<string, string>;
	method: string;
	url: string;
}

function fakeFetch(body: unknown, calls: FakeCall[]): typeof fetch {
	return vi.fn((url: string | URL, init?: RequestInit) => {
		calls.push({
			url: String(url),
			method: init?.method ?? "GET",
			headers: (init?.headers ?? {}) as Record<string, string>,
		});
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(body),
		} as Response);
	}) as unknown as typeof fetch;
}

const BASE = {
	baseUrl: "https://oc.test/",
	adminToken: "admin-k",
	runtimeToken: "runtime-k",
};

// More raw actions than the per-service cap, to prove the slice.
const RAW_ACTION_COUNT = 45;
const ACTION_CAP = 30;

describe("createOpenConnectorService listActions", () => {
	it("lists actions per service with the runtime bearer and caps the count", async () => {
		const actions = Array.from({ length: RAW_ACTION_COUNT }, (_, i) => ({
			id: `github.a${i}`,
			service: "github",
			name: `a${i}`,
			inputSchema: {},
		}));
		const calls: FakeCall[] = [];
		const service = createOpenConnectorService({
			...BASE,
			fetchImpl: fakeFetch({ success: true, data: actions }, calls),
		});

		const result = await service.listActions(["github"]);

		expect(result).toHaveLength(ACTION_CAP);
		expect(result[0]).toEqual({
			id: "github.a0",
			service: "github",
			name: "a0",
			description: "",
			inputSchema: {},
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://oc.test/v1/actions?service=github");
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.headers.authorization).toBe("Bearer runtime-k");
	});

	it("short-circuits to [] with no network call for empty services", async () => {
		const calls: FakeCall[] = [];
		const service = createOpenConnectorService({
			...BASE,
			fetchImpl: fakeFetch({ success: true, data: [] }, calls),
		});
		expect(await service.listActions([])).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe("createOpenConnectorService execute", () => {
	it("posts execute input to the runtime endpoint and maps the result", async () => {
		const calls: FakeCall[] = [];
		const service = createOpenConnectorService({
			...BASE,
			fetchImpl: fakeFetch({ success: true, data: { ok: 1 } }, calls),
		});

		const result = await service.execute({
			actionId: "github.get_current_user",
			args: { q: 1 },
		});

		expect(result).toEqual({ isError: false, output: '{"ok":1}' });
		expect(calls[0]?.url).toBe(
			"https://oc.test/v1/actions/github.get_current_user"
		);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.authorization).toBe("Bearer runtime-k");
	});

	it("returns an isError result instead of throwing on a failure envelope", async () => {
		const calls: FakeCall[] = [];
		const service = createOpenConnectorService({
			...BASE,
			fetchImpl: fakeFetch(
				{ success: false, message: "boom", errorCode: "provider_error" },
				calls
			),
		});
		const result = await service.execute({ actionId: "github.x", args: {} });
		expect(result.isError).toBe(true);
		expect(result.output).toContain("boom");
	});
});
