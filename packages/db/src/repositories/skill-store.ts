import type { SkillRow, SkillStore } from "@better-agent/agent/ports";
import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.skills.$inferSelect): SkillRow {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		description: row.description ?? null,
		instructions: row.instructions ?? null,
		allowedTools: row.allowedTools ?? null,
		mcpServerIds: row.mcpServerIds ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// The agent↔skill link ops, split into their own factory so createSkillStore
// stays under the repo's max-lines-per-function gate.
function makeAgentLinkOps(
	db: Db
): Pick<SkillStore, "assignAgent" | "unassignAgent" | "listAgentSkills"> {
	return {
		async assignAgent({ agentId, skillId }) {
			await db
				.insert(schema.agentSkills)
				.values({ agentId, skillId })
				.onConflictDoNothing();
		},
		async unassignAgent(agentId, skillId) {
			await db
				.delete(schema.agentSkills)
				.where(
					and(
						eq(schema.agentSkills.agentId, agentId),
						eq(schema.agentSkills.skillId, skillId)
					)
				);
		},
		async listAgentSkills(agentId) {
			const rows = await db
				.select({ skill: schema.skills })
				.from(schema.agentSkills)
				.innerJoin(
					schema.skills,
					eq(schema.agentSkills.skillId, schema.skills.id)
				)
				.where(eq(schema.agentSkills.agentId, agentId));
			return rows.map((row) => toRow(row.skill));
		},
	};
}

function selectSkillsByIds(db: Db, ids: string[]): Promise<SkillRow[]> {
	if (ids.length === 0) {
		return Promise.resolve([]);
	}
	return db
		.select()
		.from(schema.skills)
		.where(inArray(schema.skills.id, ids))
		.then((rows) => rows.map(toRow));
}

async function createSkill(
	db: Db,
	input: Parameters<SkillStore["create"]>[0]
): Promise<SkillRow> {
	const rows = await db.insert(schema.skills).values(input).returning();
	const row = rows[0];
	if (!row) {
		throw new Error("Failed to create skill");
	}
	return toRow(row);
}

// The plain read/write ops (everything but the agent link ops and the
// transactional delete), split into their own factory so createSkillStore
// stays under the repo's max-lines-per-function gate.
function makeSkillRwOps(
	db: Db
): Pick<SkillStore, "create" | "get" | "getMany" | "listByUser" | "update"> {
	return {
		create: (input) => createSkill(db, input),
		async get(id) {
			const rows = await db
				.select()
				.from(schema.skills)
				.where(eq(schema.skills.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		getMany: (ids) => selectSkillsByIds(db, ids),
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.skills)
				.where(eq(schema.skills.userId, userId));
			return rows.map(toRow);
		},
		async update(id, userId, patch) {
			const rows = await db
				.update(schema.skills)
				.set({ ...patch, updatedAt: new Date() })
				.where(and(eq(schema.skills.id, id), eq(schema.skills.userId, userId)))
				.returning();
			const row = rows[0];
			return row ? toRow(row) : null;
		},
	};
}

// Owner-scoped delete in one transaction: `agent_skills` FKs are ON DELETE no
// action (repo convention), so the links are removed first, then the skill
// row itself, scoped to `userId` so a non-owner's call removes nothing (and
// leaves the links, since the skill row survives).
async function deleteSkill(db: Db, id: string, userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		const owned = await tx
			.select({ id: schema.skills.id })
			.from(schema.skills)
			.where(and(eq(schema.skills.id, id), eq(schema.skills.userId, userId)))
			.limit(1);
		if (owned.length === 0) {
			return;
		}
		await tx
			.delete(schema.agentSkills)
			.where(eq(schema.agentSkills.skillId, id));
		await tx.delete(schema.skills).where(eq(schema.skills.id, id));
	});
}

export function createSkillStore(db: Db): SkillStore {
	return {
		...makeAgentLinkOps(db),
		...makeSkillRwOps(db),
		delete: (id, userId) => deleteSkill(db, id, userId),
	};
}
