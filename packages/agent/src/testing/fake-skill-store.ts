import type { SkillRow, SkillStore } from "../ports";

// In-memory SkillStore fake for router-level tests — mirrors
// fake-agent-store.ts's split-by-concern shape so createFakeSkillStore stays
// under the repo's max-lines-per-function gate. The real DB-backed store
// (packages/db/src/repositories/skill-store.ts) already has integration
// coverage; this fake only needs to behave correctly, not persist anything.

function makeSkillRwOps(
	map: Map<string, SkillRow>
): Pick<SkillStore, "create" | "get" | "getMany" | "listByUser" | "update"> {
	return {
		create(input) {
			const now = new Date();
			const skill: SkillRow = {
				id: crypto.randomUUID(),
				userId: input.userId,
				name: input.name,
				description: input.description ?? null,
				instructions: input.instructions ?? null,
				allowedTools: input.allowedTools ?? null,
				mcpServerIds: input.mcpServerIds ?? null,
				createdAt: now,
				updatedAt: now,
			};
			map.set(skill.id, skill);
			return Promise.resolve(skill);
		},
		get(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		getMany(ids) {
			return Promise.resolve(
				ids
					.map((id) => map.get(id))
					.filter((skill): skill is SkillRow => Boolean(skill))
			);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...map.values()].filter((skill) => skill.userId === userId)
			);
		},
		update(id, userId, patch) {
			const existing = map.get(id);
			if (!existing || existing.userId !== userId) {
				return Promise.resolve(null);
			}
			const updated: SkillRow = {
				...existing,
				...patch,
				updatedAt: new Date(),
			};
			map.set(id, updated);
			return Promise.resolve(updated);
		},
	};
}

function linkKey(agentId: string, skillId: string): string {
	return `${agentId}:${skillId}`;
}

function makeAgentLinkOps(
	links: Set<string>,
	map: Map<string, SkillRow>
): Pick<SkillStore, "assignAgent" | "listAgentSkills" | "unassignAgent"> {
	return {
		assignAgent({ agentId, skillId }) {
			links.add(linkKey(agentId, skillId));
			return Promise.resolve();
		},
		unassignAgent(agentId, skillId) {
			links.delete(linkKey(agentId, skillId));
			return Promise.resolve();
		},
		listAgentSkills(agentId) {
			const prefix = `${agentId}:`;
			const skillIds = [...links]
				.filter((link) => link.startsWith(prefix))
				.map((link) => link.slice(prefix.length));
			return Promise.resolve(
				skillIds
					.map((id) => map.get(id))
					.filter((skill): skill is SkillRow => Boolean(skill))
			);
		},
	};
}

export function createFakeSkillStore(seed: SkillRow[] = []): SkillStore {
	const map = new Map(seed.map((skill) => [skill.id, skill]));
	const links = new Set<string>(); // `${agentId}:${skillId}`
	return {
		...makeSkillRwOps(map),
		...makeAgentLinkOps(links, map),
		delete(id, userId) {
			const existing = map.get(id);
			if (existing && existing.userId === userId) {
				map.delete(id);
			}
			return Promise.resolve();
		},
	};
}
