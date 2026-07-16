import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

// Row types derived from the knowledgeBase router's actual outputs, so the
// web layer never drifts from the API contract (same pattern as
// memory-types.ts / utils/api-types.ts).

type Client = RouterClient<AppRouter>;

export type KnowledgeDocument = Awaited<
	ReturnType<Client["knowledgeBase"]["list"]>
>["items"][number];

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
