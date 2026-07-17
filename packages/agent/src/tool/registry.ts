import type { ToolSet } from "ai";
import { jsonSchema, tool } from "ai";
import type { DoomLoopGuard } from "../session/doom-loop";
import { DOOM_LOOP_MESSAGE } from "../session/doom-loop";
import {
	createSemaphore,
	MAX_CONCURRENT_TOOL_CALLS,
	type Semaphore,
} from "./tool-concurrency";
import { truncateOutput } from "./truncate";
import type { ToolContext, ToolDef } from "./types";

type CtxBase = Omit<ToolContext, "callId">;

async function runToolDef(
	def: ToolDef,
	args: unknown,
	options: { toolCallId: string; abortSignal?: AbortSignal },
	ctxBase: CtxBase,
	guard: DoomLoopGuard | undefined
): Promise<string> {
	if (guard?.check(def.name, args)) {
		return DOOM_LOOP_MESSAGE;
	}
	const result = await def.execute(args, {
		...ctxBase,
		abortSignal: options.abortSignal ?? ctxBase.abortSignal,
		callId: options.toolCallId,
	});
	const output = truncateOutput(result.output).output;
	if (result.isError) {
		throw new Error(output);
	}
	return output;
}

export function buildTools(
	defs: ToolDef[],
	ctxBase: CtxBase,
	opts?: { cacheLastToolDef?: boolean; guard?: DoomLoopGuard }
): ToolSet {
	const tools: ToolSet = {};
	// One semaphore shared by every tool built this turn: the AI SDK runs a
	// step's tool calls concurrently with no bound, so cap how many actually
	// execute at once to avoid overwhelming rate-limited upstreams + per-call
	// MCP connections (the rest queue).
	const sem: Semaphore = createSemaphore(MAX_CONCURRENT_TOOL_CALLS);
	for (const [i, def] of defs.entries()) {
		if (tools[def.name]) {
			throw new Error(`Duplicate tool name: ${def.name}`);
		}
		const isLast = i === defs.length - 1;
		const cacheLast = opts?.cacheLastToolDef === true && isLast;
		tools[def.name] = tool({
			description: def.description,
			inputSchema: jsonSchema(def.parameters),
			...(cacheLast
				? {
						providerOptions: {
							anthropic: { cacheControl: { type: "ephemeral" } },
						},
					}
				: {}),
			execute: (
				args: unknown,
				options: { toolCallId: string; abortSignal?: AbortSignal }
			) => sem.run(() => runToolDef(def, args, options, ctxBase, opts?.guard)),
		});
	}
	return tools;
}
