import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { accountRouter } from "./account";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { agentsRouter } from "./agents";
import { authRouter } from "./auth";
import { bridgeRouter } from "./bridge";
import { composioRouter } from "./composio";
import { computersRouter } from "./computers";
import { inviteRouter } from "./invite";
import { mcpRouter } from "./mcp";
import { memoryRouter } from "./memory";
import { openConnectorRouter } from "./openconnector";
import { providersRouter } from "./providers";
import { pushSubscriptionsRouter } from "./push-subscriptions";
import { sessionsRouter } from "./sessions";
import { skillsRouter } from "./skills";
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
	computers: computersRouter,
	invite: inviteRouter,
	mcp: mcpRouter,
	memory: memoryRouter,
	openConnector: openConnectorRouter,
	providers: providersRouter,
	pushSubscriptions: pushSubscriptionsRouter,
	agents: agentsRouter,
	sessions: sessionsRouter,
	skills: skillsRouter,
	usage: usageRouter,
	userSessions: userSessionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
