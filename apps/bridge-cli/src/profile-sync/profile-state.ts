import { join } from "node:path";
import type { ProfileState } from "./bundle";
import type { SyncFs, SyncRoots } from "./fs-ports";

// P1-C (DP3): the persisted landing record at
// `~/.better-agent/profile-state.json`. Its `version` lets a later sync skip
// work when the server Profile hasn't changed; its `skills`/`mcp` manifests let
// it clean up exactly what this tool wrote (and nothing the user placed by
// hand). A missing or unparseable file is treated as "never synced" (null) so a
// corrupt state only costs one extra full sync, never a crash.

const STATE_FILE = "profile-state.json";

function stateFilePath(roots: SyncRoots): string {
	return join(roots.betterAgentDir, STATE_FILE);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parseState(raw: string): ProfileState | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const record = (parsed ?? {}) as Record<string, unknown>;
	if (
		typeof record.version !== "number" ||
		!(isStringArray(record.skills) && isStringArray(record.mcp))
	) {
		return null;
	}
	const claudeMd = (record.claudeMd ?? {}) as Record<string, unknown>;
	return {
		claudeMd: { managed: claudeMd.managed === true },
		mcp: record.mcp,
		skills: record.skills,
		version: record.version,
	};
}

export async function readProfileState(
	fs: SyncFs,
	roots: SyncRoots
): Promise<ProfileState | null> {
	const raw = await fs.readFile(stateFilePath(roots));
	return raw === null ? null : parseState(raw);
}

export async function writeProfileState(
	fs: SyncFs,
	roots: SyncRoots,
	state: ProfileState
): Promise<void> {
	await fs.mkdir(roots.betterAgentDir);
	await fs.writeFile(
		stateFilePath(roots),
		`${JSON.stringify(state, null, "\t")}\n`
	);
}
