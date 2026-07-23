import type {
	CreateStandardInput,
	CreateTemplateInput,
	ProfileRow,
	ProfileStandardRow,
	ProfileStore,
	ProfileWithRelations,
	ProjectTemplateRow,
	UpdateStandardPatch,
	UpdateTemplatePatch,
} from "@better-agent/agent/ports";
import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toProfileRow(row: typeof schema.profiles.$inferSelect): ProfileRow {
	return {
		id: row.id,
		userId: row.userId,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toStandardRow(
	row: typeof schema.profileStandards.$inferSelect
): ProfileStandardRow {
	return {
		id: row.id,
		profileId: row.profileId,
		title: row.title,
		body: row.body,
		enabled: row.enabled,
		sortOrder: row.sortOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toTemplateRow(
	row: typeof schema.projectTemplates.$inferSelect
): ProjectTemplateRow {
	return {
		id: row.id,
		profileId: row.profileId,
		name: row.name,
		description: row.description ?? null,
		scaffold: row.scaffold,
		claudeMd: row.claudeMd ?? null,
		mcpServerIds: row.mcpServerIds,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// Idempotent: the first access inserts the row (unique user_id makes concurrent
// inserts a no-op conflict), every access returns it.
async function ensureProfile(db: Db, userId: string): Promise<ProfileRow> {
	const inserted = await db
		.insert(schema.profiles)
		.values({ userId })
		.onConflictDoNothing()
		.returning();
	if (inserted[0]) {
		return toProfileRow(inserted[0]);
	}
	const rows = await db
		.select()
		.from(schema.profiles)
		.where(eq(schema.profiles.userId, userId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new Error("Failed to ensure profile");
	}
	return toProfileRow(row);
}

async function getProfile(
	db: Db,
	userId: string
): Promise<ProfileWithRelations> {
	const profile = await ensureProfile(db, userId);
	const standards = await db
		.select()
		.from(schema.profileStandards)
		.where(eq(schema.profileStandards.profileId, profile.id))
		.orderBy(
			asc(schema.profileStandards.sortOrder),
			asc(schema.profileStandards.createdAt)
		);
	const templates = await db
		.select()
		.from(schema.projectTemplates)
		.where(eq(schema.projectTemplates.profileId, profile.id))
		.orderBy(asc(schema.projectTemplates.createdAt));
	return {
		...profile,
		standards: standards.map(toStandardRow),
		templates: templates.map(toTemplateRow),
	};
}

// Read-then-write increment (no raw `sql` — the repo's no-raw-sql hook forbids
// it in packages/db). A lost increment under concurrency is harmless: clients
// only need the version to CHANGE to know they must re-sync, not to count.
async function bumpVersion(db: Db, userId: string): Promise<void> {
	const profile = await ensureProfile(db, userId);
	await db
		.update(schema.profiles)
		.set({ version: profile.version + 1, updatedAt: new Date() })
		.where(eq(schema.profiles.userId, userId));
}

// Each op resolves the caller's own profile first, so the profileId filter on
// every where-clause makes non-owner reads/writes match nothing. Kept as
// standalone module functions (not one big factory) to stay under the repo's
// max-lines-per-function gate.

async function createStandard(
	db: Db,
	userId: string,
	input: CreateStandardInput
): Promise<ProfileStandardRow> {
	const profile = await ensureProfile(db, userId);
	const rows = await db
		.insert(schema.profileStandards)
		.values({
			profileId: profile.id,
			title: input.title,
			body: input.body,
			enabled: input.enabled,
			sortOrder: input.sortOrder,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new Error("Failed to create standard");
	}
	return toStandardRow(row);
}

async function updateStandard(
	db: Db,
	userId: string,
	standardId: string,
	patch: UpdateStandardPatch
): Promise<ProfileStandardRow | null> {
	const profile = await ensureProfile(db, userId);
	const rows = await db
		.update(schema.profileStandards)
		.set({ ...patch, updatedAt: new Date() })
		.where(
			and(
				eq(schema.profileStandards.id, standardId),
				eq(schema.profileStandards.profileId, profile.id)
			)
		)
		.returning();
	return rows[0] ? toStandardRow(rows[0]) : null;
}

async function deleteStandard(
	db: Db,
	userId: string,
	standardId: string
): Promise<void> {
	const profile = await ensureProfile(db, userId);
	await db
		.delete(schema.profileStandards)
		.where(
			and(
				eq(schema.profileStandards.id, standardId),
				eq(schema.profileStandards.profileId, profile.id)
			)
		);
}

async function reorderStandards(
	db: Db,
	userId: string,
	orderedIds: string[]
): Promise<void> {
	const profile = await ensureProfile(db, userId);
	await db.transaction(async (tx) => {
		for (const [index, id] of orderedIds.entries()) {
			await tx
				.update(schema.profileStandards)
				.set({ sortOrder: index, updatedAt: new Date() })
				.where(
					and(
						eq(schema.profileStandards.id, id),
						eq(schema.profileStandards.profileId, profile.id)
					)
				);
		}
	});
}

async function createTemplate(
	db: Db,
	userId: string,
	input: CreateTemplateInput
): Promise<ProjectTemplateRow> {
	const profile = await ensureProfile(db, userId);
	const rows = await db
		.insert(schema.projectTemplates)
		.values({
			profileId: profile.id,
			name: input.name,
			description: input.description,
			scaffold: input.scaffold,
			claudeMd: input.claudeMd,
			mcpServerIds: input.mcpServerIds,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new Error("Failed to create template");
	}
	return toTemplateRow(row);
}

async function updateTemplate(
	db: Db,
	userId: string,
	templateId: string,
	patch: UpdateTemplatePatch
): Promise<ProjectTemplateRow | null> {
	const profile = await ensureProfile(db, userId);
	const rows = await db
		.update(schema.projectTemplates)
		.set({ ...patch, updatedAt: new Date() })
		.where(
			and(
				eq(schema.projectTemplates.id, templateId),
				eq(schema.projectTemplates.profileId, profile.id)
			)
		)
		.returning();
	return rows[0] ? toTemplateRow(rows[0]) : null;
}

async function deleteTemplate(
	db: Db,
	userId: string,
	templateId: string
): Promise<void> {
	const profile = await ensureProfile(db, userId);
	await db
		.delete(schema.projectTemplates)
		.where(
			and(
				eq(schema.projectTemplates.id, templateId),
				eq(schema.projectTemplates.profileId, profile.id)
			)
		);
}

export function createProfileStore(db: Db): ProfileStore {
	return {
		ensureProfile: (userId) => ensureProfile(db, userId),
		getProfile: (userId) => getProfile(db, userId),
		bumpVersion: (userId) => bumpVersion(db, userId),
		createStandard: (userId, input) => createStandard(db, userId, input),
		updateStandard: (userId, id, patch) =>
			updateStandard(db, userId, id, patch),
		deleteStandard: (userId, id) => deleteStandard(db, userId, id),
		reorderStandards: (userId, ids) => reorderStandards(db, userId, ids),
		createTemplate: (userId, input) => createTemplate(db, userId, input),
		updateTemplate: (userId, id, patch) =>
			updateTemplate(db, userId, id, patch),
		deleteTemplate: (userId, id) => deleteTemplate(db, userId, id),
	};
}
