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

/** The agent a memory is assigned to: exactly one of a web agent (agentId) or
 * a local/bridge agent (tokenId) — mirrors the router's targetInput. */
export type MemoryTarget =
	| { agentId: string; tokenId?: undefined }
	| { tokenId: string; agentId?: undefined };
