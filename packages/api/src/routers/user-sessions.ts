import type { RunEvent } from "@better-agent/agent/session/events";
import type { Session } from "@better-agent/agent/session/types";
import { buildRemoteToolDefs } from "@better-agent/agent/tool/remote-tools";
import type { SkillActivation } from "@better-agent/agent/tool/tool-skill";
import type { ToolDef } from "@better-agent/agent/tool/types";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	attachmentIdInput,
	bytesToFile,
	uploadAttachmentInput,
	validateImageUpload,
} from "../attachments";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { assembleAgentToolDefs } from "./agent-tool-defs";
import { drain, errorMessage, promptInput } from "./sessions";
import { resolveActiveSkill } from "./skill-activation";
import {
	createTurnChannel,
	createTurnChannelRegistry,
	pumpTurn,
} from "./turn-channel";

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });

// In-memory, single-instance registry of live turns (see [[server-runs-in-docker]]).
// `prompt` registers its channel here so a reconnecting client can re-attach to
// the running turn via `observe` instead of polling listMessages.
const turnChannels = createTurnChannelRegistry();

// Skills T3: the agent's assigned skills are loadable on demand via the runtime
// `skill` tool. This returns the assembled defs, each skill's activation
// (playbook + tool names), and the name of any skill the user explicitly
// activated via /name (its tools get pre-revealed). `text` is this turn's
// just-submitted prompt, not yet persisted.
async function agentToolDefs(
	context: Context,
	agentId: string,
	sessionId: string,
	text: string
): Promise<{
	activeSkillName?: string;
	defs: ToolDef[];
	skills: SkillActivation[];
}> {
	const agent = await context.services.stores.agent.get(agentId);
	if (!agent) {
		return { defs: [], skills: [] };
	}
	const [assigned, activeSkill] = await Promise.all([
		context.services.stores.skill.listAgentSkills(agentId),
		resolveActiveSkill(context, agentId, sessionId, text),
	]);
	const assembled = await assembleAgentToolDefs(context, agent, assigned);
	return { ...assembled, activeSkillName: activeSkill?.name };
}

async function requireUserSession(
	context: Context,
	userId: string,
	sessionId: string
): Promise<Session> {
	const session = await context.services.stores.session.get(sessionId);
	if (!session || session.userId !== userId) {
		throw new ORPCError("NOT_FOUND", {
			message: `Session ${sessionId} not found`,
		});
	}
	return session;
}

async function* streamUserTurn(
	context: Context,
	userId: string,
	input: {
		sessionId: string;
		text: string;
		tools?: Array<{
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		}>;
		attachmentIds?: string[];
	}
): AsyncGenerator<RunEvent, void> {
	try {
		const session = await requireUserSession(context, userId, input.sessionId);
		const remoteDefs = input.tools
			? buildRemoteToolDefs(input.tools, context.services.pendingToolCallStore)
			: [];
		const {
			defs: toolDefs,
			skills,
			activeSkillName,
		} = await agentToolDefs(
			context,
			session.agentId,
			input.sessionId,
			input.text
		);
		const allDefs = [...remoteDefs, ...toolDefs];
		// Detached execution: the pump (kept alive via waitUntil) drives the turn;
		// this response only observes. NOTE the request abort signal is deliberately
		// NOT passed to the runtime — a client disconnect must not kill the turn.
		// Stop goes through the cancel endpoint (cancellation registry) instead.
		const channel = createTurnChannel();
		// Register for the turn's lifetime so a reconnecting client can re-attach
		// via observe; unregister once the pump (and thus the turn) finishes.
		turnChannels.register(input.sessionId, channel);
		const pump = pumpTurn(
			context.services.runtime.runTurn({
				sessionId: input.sessionId,
				text: input.text,
				tools: allDefs.length > 0 ? allDefs : undefined,
				skills: skills.length > 0 ? skills : undefined,
				activeSkillName,
				attachmentIds: input.attachmentIds,
			}),
			channel,
			(error) => ({ type: "error", message: errorMessage(error) })
		).finally(() => turnChannels.unregister(input.sessionId));
		context.waitUntil?.(pump);
		yield* channel.observe();
	} catch (error) {
		yield { type: "error", message: errorMessage(error) };
	}
}

// Re-attach to a session's in-flight turn: replays the running turn's events
// (message-start + everything so far) then tails live, so a reconnecting client
// renders the turn without polling. Yields nothing if no turn is running (the
// client then just shows the persisted history from listMessages).
async function* observeUserTurn(
	context: Context,
	userId: string,
	sessionId: string
): AsyncGenerator<RunEvent, void> {
	await requireUserSession(context, userId, sessionId);
	const channel = turnChannels.get(sessionId);
	if (!channel) {
		return;
	}
	yield* channel.observe();
}

export const userSessionsRouter = {
	create: authorizedUserProcedure
		.input(z.object({ agentId: z.uuid() }))
		.handler(async ({ input, context }) => {
			const agent = await context.services.stores.agent.get(input.agentId);
			if (!agent) {
				throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
			}
			return context.services.stores.session.create({
				agentId: input.agentId,
				userId: context.authedUser.id,
			});
		}),

	list: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.session.listByUser(context.authedUser.id)
	),

	get: authorizedUserProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireUserSession(context, context.authedUser.id, input.id)
		),

	listMessages: authorizedUserProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			return context.services.stores.message.listWithParts(input.sessionId);
		}),

	uploadAttachment: authorizedUserProcedure
		.input(uploadAttachmentInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			const validated = await validateImageUpload(input.file);
			const row = await context.services.stores.attachment.create({
				sessionId: input.sessionId,
				data: validated.data,
				mime: validated.mime,
				name: validated.name,
			});
			return { id: row.id, mime: row.mime, name: row.name, size: row.size };
		}),

	getAttachment: authorizedUserProcedure
		.input(attachmentIdInput)
		.handler(async ({ input, context }) => {
			const row = await context.services.stores.attachment.getById(input.id);
			if (!row) {
				throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
			}
			await requireUserSession(context, context.authedUser.id, row.sessionId);
			const bytes = await context.services.stores.attachment.getBytes(input.id);
			if (!bytes) {
				throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
			}
			return bytesToFile(bytes, row.name, row.mime);
		}),

	run: authorizedUserProcedure
		.input(promptInput)
		.handler(async ({ input, context, signal }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			const toolDefs = input.tools
				? buildRemoteToolDefs(
						input.tools,
						context.services.pendingToolCallStore
					)
				: undefined;
			return drain(
				context.services.runtime.runTurn({
					sessionId: input.sessionId,
					text: input.text,
					tools: toolDefs,
					attachmentIds: input.attachmentIds,
					abortSignal: signal,
				})
			);
		}),

	prompt: authorizedUserProcedure
		.input(promptInput)
		.handler(({ input, context }) =>
			streamUserTurn(context, context.authedUser.id, input)
		),

	observe: authorizedUserProcedure
		.input(sessionIdInput)
		.handler(({ input, context }) =>
			observeUserTurn(context, context.authedUser.id, input.sessionId)
		),

	cancel: authorizedUserProcedure
		.input(sessionIdInput)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			await context.services.cancellation.cancel(input.sessionId);
			return { ok: true };
		}),

	submitToolResult: authorizedUserProcedure
		.input(
			z.object({
				sessionId: z.uuid(),
				callId: z.string().min(1),
				result: z.string(),
				isError: z.boolean().default(false),
			})
		)
		.handler(async ({ input, context }) => {
			await requireUserSession(context, context.authedUser.id, input.sessionId);
			await context.services.pendingToolCallStore.resolve({
				sessionId: input.sessionId,
				callId: input.callId,
				result: { output: input.result, isError: input.isError },
			});
			return { ok: true };
		}),
};
