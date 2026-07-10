import type { McpServerRow } from "@better-agent/agent/ports";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ALICE = {
	id: "a-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};
const BOB = {
	id: "b-uid",
	email: "bob@x.com",
	createdAt: new Date(),
	blocked: false,
};

const AUTH_LAST4 = 4;

function applyServerUpdate(
	rows: McpServerRow[],
	id: string,
	patch: { name?: string; url?: string; authHeader?: string | null }
): McpServerRow | null {
	const row = rows.find((r) => r.id === id);
	if (!row) {
		return null;
	}
	if (patch.name !== undefined) {
		row.name = patch.name;
	}
	if (patch.url !== undefined) {
		row.url = patch.url;
	}
	if (patch.authHeader !== undefined) {
		row.authLast4 = patch.authHeader
			? patch.authHeader.slice(-AUTH_LAST4)
			: null;
	}
	return row;
}

function memoryServerStore() {
	const rows: McpServerRow[] = [];
	return {
		rows,
		listByUser: (userId: string) =>
			Promise.resolve(rows.filter((row) => row.userId === userId)),
		getById: (id: string) =>
			Promise.resolve(rows.find((row) => row.id === id) ?? null),
		getAuthHeader: () => Promise.resolve(null),
		create: (input: {
			name: string;
			url: string;
			authHeader?: string;
			userId: string;
		}) => {
			const row: McpServerRow = {
				id: crypto.randomUUID(),
				name: input.name,
				url: input.url,
				userId: input.userId,
				authLast4: input.authHeader?.slice(-AUTH_LAST4) ?? null,
				createdAt: new Date(),
			};
			rows.push(row);
			return Promise.resolve(row);
		},
		delete: (id: string) => {
			const idx = rows.findIndex((row) => row.id === id);
			if (idx >= 0) {
				rows.splice(idx, 1);
			}
			return Promise.resolve();
		},
		update: (
			id: string,
			patch: { name?: string; url?: string; authHeader?: string | null }
		) => Promise.resolve(applyServerUpdate(rows, id, patch)),
	};
}

function build() {
	const serverStore = memoryServerStore();
	const services = {
		authz: { enabled: false },
		mcp: () =>
			Promise.resolve({
				listTools: () =>
					Promise.resolve([
						{ name: "X_SEARCH", description: "", parameters: {} },
					]),
				execute: () => Promise.resolve({ output: "" }),
			}),
		stores: {
			activity: { log: () => Promise.resolve() },
			agent: { unlinkMcpServer: () => Promise.resolve() },
			mcpServer: serverStore,
		},
	};
	const clientFor = (user: typeof ALICE) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: user,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	return { serverStore, clientFor };
}

it("servers are scoped to their owner; foreign access is NOT_FOUND", async () => {
	const { clientFor } = build();
	const alice = clientFor(ALICE);
	const bob = clientFor(BOB);

	const server = await alice.mcp.createServer({
		name: "X API",
		url: "https://api.x.com/mcp",
		bearerToken: "tok_1234",
	});
	expect(server.userId).toBe(ALICE.id);
	expect((await alice.mcp.listServers()).map((s) => s.id)).toContain(server.id);
	expect(await bob.mcp.listServers()).toHaveLength(0);

	await expect(bob.mcp.tools({ serverId: server.id })).rejects.toThrow();
	await expect(bob.mcp.deleteServer({ serverId: server.id })).rejects.toThrow();

	const tools = await alice.mcp.tools({ serverId: server.id });
	expect(tools[0]?.name).toBe("X_SEARCH");

	await alice.mcp.deleteServer({ serverId: server.id });
	expect(await alice.mcp.listServers()).toHaveLength(0);
});

it("updateServer patches an owned server, including clearing its token, and rejects a non-owner", async () => {
	const { clientFor } = build();
	const alice = clientFor(ALICE);
	const bob = clientFor(BOB);

	const server = await alice.mcp.createServer({
		name: "X API",
		url: "https://api.x.com/mcp",
		bearerToken: "tok_1234",
	});

	await expect(
		bob.mcp.updateServer({ serverId: server.id, name: "Hijacked" })
	).rejects.toThrow();

	const renamed = await alice.mcp.updateServer({
		serverId: server.id,
		name: "X API v2",
		url: "https://api.x.com/mcp/v2",
	});
	expect(renamed).toMatchObject({
		name: "X API v2",
		url: "https://api.x.com/mcp/v2",
		authLast4: "1234",
	});

	const rotated = await alice.mcp.updateServer({
		serverId: server.id,
		bearerToken: "tok_5678",
	});
	expect(rotated?.authLast4).toBe("5678");
	// Untouched fields survive a partial update.
	expect(rotated?.name).toBe("X API v2");

	const cleared = await alice.mcp.updateServer({
		serverId: server.id,
		bearerToken: null,
	});
	expect(cleared?.authLast4).toBeNull();
});
