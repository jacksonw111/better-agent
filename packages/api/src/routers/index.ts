import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { accountRouter } from "./account";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { agentsRouter } from "./agents";
import { authRouter } from "./auth";
import { bridgeRouter } from "./bridge";
import { composioRouter } from "./composio";
import { inviteRouter } from "./invite";
import { mcpRouter } from "./mcp";
import { memoryRouter } from "./memory";
import { providersRouter } from "./providers";
import { sessionsRouter } from "./sessions";
import { usageRouter } from "./usage";
import { userSessionsRouter } from "./user-sessions";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => "OK"),
	auth: authRouter,
	account: accountRouter,
	activity: activityRouter,
	admin: adminRouter,
	bridge: bridgeRouter,
	composio: composioRouter,
	invite: inviteRouter,
	mcp: mcpRouter,
	memory: memoryRouter,
	providers: providersRouter,
	agents: agentsRouter,
	sessions: sessionsRouter,
	usage: usageRouter,
	userSessions: userSessionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
