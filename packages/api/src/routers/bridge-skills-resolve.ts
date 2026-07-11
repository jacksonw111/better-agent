import type { Context } from "../context";

// R5-T2: resolves a bridge token's assigned `config.skillIds` into the
// skill content the CLI writes as `SKILL.md` files, shared by `startSession`
// (bridge.ts) and `fetchConfig` (bridge-restart.ts). Mirrors
// bridge-mcp-resolve.ts's `resolveMcpServers` field-for-field — same
// owner-scoped resolve, same "skip non-owned/deleted ids silently" contract.

/** A registered skill resolved to what the CLI needs to write a `SKILL.md`:
 * name/description/instructions, the same shape `ResolvedSkill` in
 * `apps/bridge-cli/src/adapters/types.ts` redeclares locally (that file takes
 * no runtime dep on this package). */
export interface ResolvedSkill {
	description: string;
	instructions: string;
	name: string;
}

async function resolveOne(
	context: Context,
	userId: string,
	id: string
): Promise<ResolvedSkill | null> {
	const skill = await context.services.stores.skill.get(id);
	// Owner-scoped: an id for another user's skill (or one that's since been
	// deleted) is silently skipped, not surfaced as an error — a token's
	// persisted config can outlive the skill it references.
	if (!skill || skill.userId !== userId) {
		return null;
	}
	return {
		name: skill.name,
		description: skill.description ?? "",
		instructions: skill.instructions ?? "",
	};
}

/** Resolves `skillIds` (in order, deduped ids only implicitly via the source
 * array) into `ResolvedSkill`s, owner-scoped to `userId`. Returns `[]` for an
 * empty/absent list rather than short-circuiting the caller. */
export async function resolveSkills(
	context: Context,
	userId: string,
	skillIds: string[] | undefined
): Promise<ResolvedSkill[]> {
	if (!skillIds || skillIds.length === 0) {
		return [];
	}
	const resolved = await Promise.all(
		skillIds.map((id) => resolveOne(context, userId, id))
	);
	return resolved.filter((skill): skill is ResolvedSkill => skill !== null);
}
