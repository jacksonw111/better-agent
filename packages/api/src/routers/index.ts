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
import { githubRouter } from "./github";
import { inviteRouter } from "./invite";
import { knowledgeBaseRouter } from "./knowledge-base";
import { mcpRouter } from "./mcp";
import { memoryRouter } from "./memory";
import { openConnectorRouter } from "./openconnector";
import { profilesRouter } from "./profiles";
import { projectsRouter } from "./projects";
import { providersRouter } from "./providers";
import { ptyRouter } from "./pty";
import { pushSubscriptionsRouter } from "./push-subscriptions";
import { runsRouter } from "./runs";
import { sessionsRouter } from "./sessions";
import { skillsRouter } from "./skills";
import { tasksRouter } from "./tasks";
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
	github: githubRouter,
	invite: inviteRouter,
	knowledgeBase: knowledgeBaseRouter,
	mcp: mcpRouter,
	memory: memoryRouter,
	openConnector: openConnectorRouter,
	profiles: profilesRouter,
	projects: projectsRouter,
	providers: providersRouter,
	pty: ptyRouter,
	pushSubscriptions: pushSubscriptionsRouter,
	agents: agentsRouter,
	runs: runsRouter,
	sessions: sessionsRouter,
	skills: skillsRouter,
	tasks: tasksRouter,
	usage: usageRouter,
	userSessions: userSessionsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
