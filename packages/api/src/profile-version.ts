import type { ProfileStore } from "@better-agent/agent/ports";

// Any profile-affecting change bumps the user's profile version so a CLI can
// tell it must re-sync. Centralized here (DP1) rather than scattered across
// stores, and called from the profiles, skills and MCP routers alike — a
// standard/template edit AND a skill/MCP change all move the same version.
//
// The store is optional so test harnesses that don't wire a profile store
// (e.g. the skills/mcp fake-store router tests) treat the bump as a no-op
// instead of crashing on an undefined store.
export function bumpProfileVersion(
	profile: ProfileStore | undefined,
	userId: string
): Promise<void> {
	return profile ? profile.bumpVersion(userId) : Promise.resolve();
}
