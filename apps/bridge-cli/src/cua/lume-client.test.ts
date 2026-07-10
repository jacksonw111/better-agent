import { describe, expect, it, vi } from "vitest";
import { createLumeClient, mapVm } from "./lume-client";

const RUN_ERROR_PATTERN = /POST \/lume\/vms\/mac\/run.*500/;

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function emptyResponse(status: number): Response {
	return new Response(null, { status });
}

function firstCall(
	fetchImpl: ReturnType<typeof vi.fn>
): [string, RequestInit | undefined] {
	const call = fetchImpl.mock.calls[0];
	if (!call) {
		throw new Error("expected fetchImpl to have been called");
	}
	return call as [string, RequestInit | undefined];
}

describe("mapVm", () => {
	it("normalizes a running VM with camelCase fields", () => {
		expect(
			mapVm({
				name: "mac",
				status: "running",
				vncUrl: "vnc://localhost:5900",
				ipAddress: "192.168.64.2",
			})
		).toEqual({
			name: "mac",
			status: "running",
			vncUrl: "vnc://localhost:5900",
			ipAddress: "192.168.64.2",
		});
	});

	it("normalizes a running VM with snake_case / state fields", () => {
		expect(
			mapVm({
				name: "mac",
				state: "running",
				vnc_url: "vnc://localhost:5901",
				ip_address: "192.168.64.3",
			})
		).toEqual({
			name: "mac",
			status: "running",
			vncUrl: "vnc://localhost:5901",
			ipAddress: "192.168.64.3",
		});
	});

	it("is null-safe for a stopped VM with no vnc/ip fields", () => {
		expect(mapVm({ name: "mac", status: "stopped" })).toEqual({
			name: "mac",
			status: "stopped",
			vncUrl: null,
			ipAddress: null,
		});
	});

	it("falls back to 'unknown' status when nothing is present", () => {
		expect(mapVm({ name: "mac" })).toEqual({
			name: "mac",
			status: "unknown",
			vncUrl: null,
			ipAddress: null,
		});
	});
});

describe("createLumeClient run/stop", () => {
	it("run() POSTs /lume/vms/:name/run and resolves on 202", async () => {
		const fetchImpl = vi.fn(async () => emptyResponse(202));
		const client = createLumeClient({ fetchImpl });

		await expect(client.run("mac")).resolves.toBeUndefined();

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = firstCall(fetchImpl);
		expect(url).toBe("http://localhost:7777/lume/vms/mac/run");
		expect(init).toMatchObject({ method: "POST" });
	});

	it("stop() POSTs /lume/vms/:name/stop and resolves on 200", async () => {
		const fetchImpl = vi.fn(async () => emptyResponse(200));
		const client = createLumeClient({ fetchImpl });

		await client.stop("mac");

		const [url, init] = firstCall(fetchImpl);
		expect(url).toBe("http://localhost:7777/lume/vms/mac/stop");
		expect(init).toMatchObject({ method: "POST" });
	});

	it("strips a trailing slash from baseUrl", async () => {
		const fetchImpl = vi.fn(async () => emptyResponse(200));
		const client = createLumeClient({
			baseUrl: "http://localhost:7777/",
			fetchImpl,
		});

		await client.stop("mac");

		const [url] = firstCall(fetchImpl);
		expect(url).toBe("http://localhost:7777/lume/vms/mac/stop");
	});
});

describe("createLumeClient list/get", () => {
	it("list() maps a fixture array to LumeVm[], null-safe for stopped VMs", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse(200, [
				{
					name: "mac-running",
					state: "running",
					vncUrl: "vnc://localhost:5900",
					ipAddress: "192.168.64.2",
				},
				{ name: "mac-stopped", status: "stopped" },
			])
		);
		const client = createLumeClient({ fetchImpl });

		const vms = await client.list();

		expect(vms).toEqual([
			{
				name: "mac-running",
				status: "running",
				vncUrl: "vnc://localhost:5900",
				ipAddress: "192.168.64.2",
			},
			{
				name: "mac-stopped",
				status: "stopped",
				vncUrl: null,
				ipAddress: null,
			},
		]);
	});

	it("get() returns null on 404", async () => {
		const fetchImpl = vi.fn(async () => emptyResponse(404));
		const client = createLumeClient({ fetchImpl });

		await expect(client.get("missing")).resolves.toBeNull();
	});

	it("get() returns the mapped VM when found", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse(200, { name: "mac", status: "running" })
		);
		const client = createLumeClient({ fetchImpl });

		await expect(client.get("mac")).resolves.toEqual({
			name: "mac",
			status: "running",
			vncUrl: null,
			ipAddress: null,
		});
	});
});

describe("createLumeClient create/errors", () => {
	it("create() POSTs /lume/vms with the input body", async () => {
		const fetchImpl = vi.fn(async () => emptyResponse(201));
		const client = createLumeClient({ fetchImpl });

		await client.create({ name: "mac", os: "macos", cpu: 4, memory: "8GB" });

		const [url, init] = firstCall(fetchImpl);
		expect(url).toBe("http://localhost:7777/lume/vms");
		expect(init).toMatchObject({ method: "POST" });
		expect(JSON.parse(init?.body as string)).toEqual({
			name: "mac",
			os: "macos",
			cpu: 4,
			memory: "8GB",
		});
	});

	it("throws with method, path, and status on a non-2xx response", async () => {
		const fetchImpl = vi.fn(async () => emptyResponse(500));
		const client = createLumeClient({ fetchImpl });

		await expect(client.run("mac")).rejects.toThrow(RUN_ERROR_PATTERN);
	});
});
