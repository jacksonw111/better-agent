import type { AgentConfig } from "../agent/types";
import type { AgentStore } from "../ports";

function makeAgentTokenOps(
	map: Map<string, AgentConfig>,
	hashes: Map<string, string>,
	tokens: Map<string, string>
): Pick<AgentStore, "create" | "findByTokenHash" | "rotateToken" | "getToken"> {
	return {
		create({ tokenHash, token, ...rest }) {
			const now = new Date();
			const agent: AgentConfig = {
				id: crypto.randomUUID(),
				...rest,
				composioAccountIds: rest.composioAccountIds ?? [],
				mcpServerIds: rest.mcpServerIds ?? [],
				toolAllowlist: rest.toolAllowlist ?? null,
				builtinTools: rest.builtinTools ?? [],
				userId: rest.userId ?? null,
				createdAt: now,
				updatedAt: now,
			};
			map.set(agent.id, agent);
			hashes.set(agent.id, tokenHash);
			if (token !== undefined) {
				tokens.set(agent.id, token);
			}
			return Promise.resolve(agent);
		},
		findByTokenHash(tokenHash) {
			const found = [...hashes].find(([, hash]) => hash === tokenHash);
			return Promise.resolve((found && map.get(found[0])) ?? null);
		},
		getToken(id) {
			return Promise.resolve(tokens.get(id) ?? null);
		},
		rotateToken(id, tokenHash, token) {
			const existing = map.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			hashes.set(id, tokenHash);
			if (token !== undefined) {
				tokens.set(id, token);
			}
			const updated: AgentConfig = { ...existing, updatedAt: new Date() };
			map.set(id, updated);
			return Promise.resolve(updated);
		},
	};
}

function unlinkFromArray(
	map: Map<string, AgentConfig>,
	userId: string,
	field: "mcpServerIds" | "composioAccountIds",
	id: string
): void {
	for (const agent of map.values()) {
		if (agent.userId === userId && agent[field].includes(id)) {
			agent[field] = agent[field].filter((value) => value !== id);
		}
	}
}

export function createFakeAgentStore(seed: AgentConfig[] = []): AgentStore {
	const map = new Map(seed.map((agent) => [agent.id, agent]));
	const hashes = new Map<string, string>(); // agentId -> tokenHash
	const tokens = new Map<string, string>(); // agentId -> plaintext token
	return {
		...makeAgentTokenOps(map, hashes, tokens),
		get(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		list() {
			return Promise.resolve([...map.values()]);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...map.values()].filter((agent) => agent.userId === userId)
			);
		},
		update(id, input) {
			const existing = map.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const updated: AgentConfig = {
				...existing,
				...input,
				updatedAt: new Date(),
			};
			map.set(id, updated);
			return Promise.resolve(updated);
		},
		delete(id) {
			map.delete(id);
			hashes.delete(id);
			tokens.delete(id);
			return Promise.resolve();
		},
		unlinkMcpServer(userId, serverId) {
			unlinkFromArray(map, userId, "mcpServerIds", serverId);
			return Promise.resolve();
		},
		unlinkComposioAccount(userId, accountId) {
			unlinkFromArray(map, userId, "composioAccountIds", accountId);
			return Promise.resolve();
		},
		// AgentConfig doesn't track open-connector account ids yet; no-op until it does.
		unlinkOpenConnectorAccount(_userId, _accountId) {
			return Promise.resolve();
		},
	};
}
