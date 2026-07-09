// Skill-system port types (web-agent Skills T1), split out of ports.ts so
// that file stays under the repo's 300-line limit — mirrors memory-ports.ts.
//
// A `skill` is a reusable method/procedure bundle assignable to an agent:
// { name, description, instructions, allowedTools?, mcpServerIds? }.
// `agent_skills` links agents to skills many-to-many with no per-link role —
// a skill is either assigned to an agent or it isn't (unlike memories' read /
// read_write). Owner/authz scoping is enforced at the API layer — this store
// takes ids.

/** A reusable method/procedure bundle assignable to an agent. */
export interface SkillRow {
	allowedTools: string[] | null;
	createdAt: Date;
	description: string | null;
	id: string;
	instructions: string | null;
	mcpServerIds: string[] | null;
	name: string;
	updatedAt: Date;
	userId: string;
}

/** An agent↔skill link row. */
export interface AgentSkillRow {
	skillId: string;
}

export interface SkillStore {
	/** Links a skill to an agent (no-op if already linked). */
	assignAgent(input: { agentId: string; skillId: string }): Promise<void>;
	create(input: {
		userId: string;
		name: string;
		description?: string;
		instructions?: string;
		allowedTools?: string[];
		mcpServerIds?: string[];
	}): Promise<SkillRow>;
	/** Owner-scoped delete: only removes the row when it belongs to `userId`. */
	delete(id: string, userId: string): Promise<void>;
	get(id: string): Promise<SkillRow | null>;
	/** Batch fetch: the skills for the given ids in one query (order and
	 * completeness not guaranteed — missing ids are simply absent). */
	getMany(ids: string[]): Promise<SkillRow[]>;
	/** The skills assigned to an agent, resolved (not just ids). */
	listAgentSkills(agentId: string): Promise<SkillRow[]>;
	listByUser(userId: string): Promise<SkillRow[]>;
	unassignAgent(agentId: string, skillId: string): Promise<void>;
	/** Owner-scoped partial update; unset fields are left unchanged. Returns
	 * null if the skill doesn't exist or isn't owned by `userId`. */
	update(
		id: string,
		userId: string,
		patch: {
			name?: string;
			description?: string | null;
			instructions?: string | null;
			allowedTools?: string[] | null;
			mcpServerIds?: string[] | null;
		}
	): Promise<SkillRow | null>;
}
