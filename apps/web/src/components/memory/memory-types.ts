import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

// Row types derived from the memory router's actual outputs, so the web layer
// never drifts from the API contract (same pattern as utils/api-types.ts).

type Client = RouterClient<AppRouter>;

export type MemoryRow = Awaited<
	ReturnType<Client["memory"]["listMemories"]>
>[number];

export type MemoryItemRow = Awaited<
	ReturnType<Client["memory"]["listItems"]>
>[number];

export type AssignedMemoryRow = Awaited<
	ReturnType<Client["memory"]["listAssigned"]>
>[number];

export type MemoryRole = AssignedMemoryRow["role"];

/** Shared with MemoryCardList and MemoryTable so the two views' "Created"
 * columns can't drift out of format with each other. */
export const memoryCreatedFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

/** The description fallback for a memory with none set — shared by
 * MemoryCardList and MemoryTable so the two views can't drift on copy. */
export function memoryDescription(
	memory: Pick<MemoryRow, "description">
): string {
	return memory.description ?? "—";
}

/** The agent a memory is assigned to: exactly one of a web agent (agentId) or
 * a local/bridge agent (tokenId) — mirrors the router's targetInput. */
export type MemoryTarget =
	| { agentId: string; tokenId?: undefined }
	| { tokenId: string; agentId?: undefined };
