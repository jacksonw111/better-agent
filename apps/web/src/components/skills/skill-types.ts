import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

// Row types derived from the skills router's actual outputs, so the web layer
// never drifts from the API contract (same pattern as memory-types.ts).

type Client = RouterClient<AppRouter>;

export type SkillRow = Awaited<ReturnType<Client["skills"]["list"]>>[number];
