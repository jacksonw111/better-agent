import type { McpServerRow, McpServerStore } from "@better-agent/agent/ports";

// The in-memory McpServerStore fixture for the R5-a bridge-mcp-resolve tests,
// split out of bridge-test-helpers.ts to keep that file under the 300-line
// cap. Only supports what those tests exercise (create/getById/getAuthHeader/
// listByUser/delete) — not a full McpServerStore replica.

const AUTH_LAST4 = 4;

/** In-memory McpServerStore (name/url/auth-header only — enough for the R5-a
 * bridge-mcp-resolve tests, which only exercise getById/getAuthHeader). */
export function memoryMcpServerStore(
	rows: Map<string, McpServerRow>,
	authHeaders: Map<string, string>
): McpServerStore {
	return {
		create({ name, url, authHeader, userId }) {
			const row: McpServerRow = {
				id: crypto.randomUUID(),
				name,
				url,
				userId,
				authLast4: authHeader ? authHeader.slice(-AUTH_LAST4) : null,
				createdAt: new Date(),
			};
			rows.set(row.id, row);
			if (authHeader) {
				authHeaders.set(row.id, authHeader);
			}
			return Promise.resolve(row);
		},
		delete(id) {
			rows.delete(id);
			authHeaders.delete(id);
			return Promise.resolve();
		},
		getAuthHeader(id) {
			return Promise.resolve(authHeaders.get(id) ?? null);
		},
		getById(id) {
			return Promise.resolve(rows.get(id) ?? null);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.userId === userId)
			);
		},
	};
}
