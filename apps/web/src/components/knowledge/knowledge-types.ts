import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

// Row types derived from the knowledgeBase router's actual outputs, so the
// web layer never drifts from the API contract (same pattern as
// memory-types.ts / utils/api-types.ts).

type Client = RouterClient<AppRouter>;

export type KnowledgeDocument = Awaited<
	ReturnType<Client["knowledgeBase"]["list"]>
>["items"][number];

const BYTE_UNIT = 1024;
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** "1.4 MB"-style size for list rows and the drawer header. */
export function formatBytes(bytes: number): string {
	let value = bytes;
	let unitIndex = 0;
	while (value >= BYTE_UNIT && unitIndex < BYTE_UNITS.length - 1) {
		value /= BYTE_UNIT;
		unitIndex += 1;
	}
	const rounded = unitIndex === 0 ? value : Number(value.toFixed(1));
	return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

/** Shared by the list rows and the drawer so upload-time formats can't
 * drift between the two views. */
export const documentTimeFormatter = new Intl.DateTimeFormat(undefined, {
	timeStyle: "short",
});

/** Full upload timestamp for the drawer header. */
export const documentDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});
