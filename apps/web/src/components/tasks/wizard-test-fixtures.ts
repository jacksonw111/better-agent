import type { ComputerListItem } from "@/utils/api-types";

// Shared fixtures for the New Task wizard's Testing Library suites
// (new-task-wizard.test.tsx / new-task-wizard-start.test.tsx): three
// computers that exercise every §19.3 dependency case — a connected one with
// a discoverable-skills runtime AND a capability-"none" runtime, a connected
// one whose inventory is incompatible with the first, and an offline one.

export function makeComputer(
	overrides: Partial<ComputerListItem> = {}
): ComputerListItem {
	return {
		id: "computer-1",
		name: "Studio Mac",
		platform: "darwin",
		arch: "arm64",
		clientVersion: "0.3.0",
		connected: true,
		createdAt: new Date("2026-07-15T10:00:00.000Z"),
		lastSeenAt: new Date("2026-07-15T12:00:00.000Z"),
		runtimeInventory: [
			{
				agentKind: "claude-code",
				skillCapability: "discoverable",
				skills: [
					{ name: "research", description: "deep research" },
					{ name: "to-spec", description: "spec writer" },
				],
			},
			{ agentKind: "codex", skillCapability: "none", skills: [] },
		],
		toolInventory: [
			{ name: "git", installed: true },
			{ name: "gh", installed: false },
		],
		...overrides,
	};
}

/** Connected, claude-code (discoverable, 2 skills) + codex (none). */
export const studioMac = makeComputer();

/** Connected, codex only — switching to it invalidates claude-code. */
export const travelLaptop = makeComputer({
	id: "computer-2",
	name: "Travel Laptop",
	runtimeInventory: [
		{ agentKind: "codex", skillCapability: "none", skills: [] },
	],
});

/** Offline but fully inventoried — viewable, never a launch target. */
export const offlineBox = makeComputer({
	id: "computer-3",
	name: "Offline Box",
	connected: false,
});
