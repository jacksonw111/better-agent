// Profile-system port types (Phase 1, DP1), split out of ports.ts so that file
// stays under the repo's 300-line limit — mirrors memory-ports.ts / skill-ports.ts.
//
// A Profile is the server-side single source of truth a CLI syncs down to a
// machine: a versioned bundle of coding standards and project templates. Skills
// and MCP servers reuse their existing tables; the Profile only carries the
// version that ties them together. Owner/authz scoping is enforced at the API
// layer — the store keys every operation by `userId` and resolves the owning
// profile itself, so a non-owner can never reach another user's rows.

/** The user's profile envelope (one per user). */
export interface ProfileRow {
	createdAt: Date;
	id: string;
	updatedAt: Date;
	userId: string;
	/** Bumped on any profile-affecting change (standards/templates/skills/MCP). */
	version: number;
}

/** A single coding/behaviour standard, rendered into the managed CLAUDE.md block. */
export interface ProfileStandardRow {
	body: string;
	createdAt: Date;
	enabled: boolean;
	id: string;
	profileId: string;
	sortOrder: number;
	title: string;
	updatedAt: Date;
}

/** File/dir scaffold a template lays down when a project is created. */
export interface TemplateScaffold {
	dirs: string[];
	files: { content: string; path: string }[];
}

/** A reusable project scaffold with optional CLAUDE.md increment + MCP servers. */
export interface ProjectTemplateRow {
	claudeMd: string | null;
	createdAt: Date;
	description: string | null;
	id: string;
	mcpServerIds: string[];
	name: string;
	profileId: string;
	scaffold: TemplateScaffold;
	updatedAt: Date;
}

/** A profile with its standards (sorted) and templates resolved. */
export interface ProfileWithRelations extends ProfileRow {
	standards: ProfileStandardRow[];
	templates: ProjectTemplateRow[];
}

export interface CreateStandardInput {
	body: string;
	enabled?: boolean;
	sortOrder?: number;
	title: string;
}

export interface UpdateStandardPatch {
	body?: string;
	enabled?: boolean;
	sortOrder?: number;
	title?: string;
}

export interface CreateTemplateInput {
	claudeMd?: string | null;
	description?: string | null;
	mcpServerIds?: string[];
	name: string;
	scaffold?: TemplateScaffold;
}

export interface UpdateTemplatePatch {
	claudeMd?: string | null;
	description?: string | null;
	mcpServerIds?: string[];
	name?: string;
	scaffold?: TemplateScaffold;
}

export interface ProfileStore {
	/** Bumps the user's profile version by one (ensuring the profile first), so
	 * any profile-affecting change signals clients to re-sync. */
	bumpVersion(userId: string): Promise<void>;
	createStandard(
		userId: string,
		input: CreateStandardInput
	): Promise<ProfileStandardRow>;
	createTemplate(
		userId: string,
		input: CreateTemplateInput
	): Promise<ProjectTemplateRow>;
	/** Owner-scoped delete: removes nothing when the row isn't the user's. */
	deleteStandard(userId: string, standardId: string): Promise<void>;
	deleteTemplate(userId: string, templateId: string): Promise<void>;
	/** Returns the user's profile, creating it on first access (idempotent). */
	ensureProfile(userId: string): Promise<ProfileRow>;
	/** The user's profile with standards + templates resolved (ensures first). */
	getProfile(userId: string): Promise<ProfileWithRelations>;
	/** Sets sort_order to match `orderedIds`; ids not on the user's profile are
	 * ignored. Missing ids leave their rows untouched. */
	reorderStandards(userId: string, orderedIds: string[]): Promise<void>;
	/** Owner-scoped partial update; returns null when the row isn't the user's. */
	updateStandard(
		userId: string,
		standardId: string,
		patch: UpdateStandardPatch
	): Promise<ProfileStandardRow | null>;
	updateTemplate(
		userId: string,
		templateId: string,
		patch: UpdateTemplatePatch
	): Promise<ProjectTemplateRow | null>;
}
