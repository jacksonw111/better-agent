import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { ToolRegistry } from "@better-agent/ui/components/chat/tool-registry";
import type { ReactNode } from "react";
import type { ZodType } from "zod";
import { FINANCE_RENDERERS } from "./finance/finance-renderers";
import { unwrapToolResult } from "./tool-result-envelope";
import { TweetCardFromTweet } from "./tweet-card-node";
import { UserCard } from "./user-card";
import {
	type NormalizedProfileData,
	NormalizedProfileSchema,
	type NormalizedTweetData,
	NormalizedTweetSchema,
} from "./x-result-schemas";

/** Long tool results (a search returning dozens of tweets) render at most
 * this many items, plus a "+N more" line — the chat pane isn't a timeline. */
export const MAX_RENDERED_ITEMS = 20;

interface TaskToolInputShape {
	description?: unknown;
	prompt?: unknown;
	subagent_type?: unknown;
}

function hasSubagentType(input: TaskToolInputShape): boolean {
	return typeof input.subagent_type === "string" && input.subagent_type !== "";
}

function hasDescriptionAndPrompt(input: TaskToolInputShape): boolean {
	return (
		typeof input.description === "string" && typeof input.prompt === "string"
	);
}

/** A subagent "Task" tool call is identified by its INPUT shape, not its
 * tool name: opencode names each call after its own dynamic `description`
 * (e.g. "Explore project structure"), so a fixed-name registry entry like
 * the ones below can never key it. Claude's built-in Task tool and
 * opencode's task-spawning tool both pass a `subagent_type`, or at least a
 * `description` + `prompt` pair — either is enough to identify it. */
export function isTaskToolInput(input: unknown): boolean {
	if (typeof input !== "object" || input === null) {
		return false;
	}
	const record = input as TaskToolInputShape;
	return hasSubagentType(record) || hasDescriptionAndPrompt(record);
}

export interface ToolResultRenderer {
	/** Parses a raw tool-result value (see unwrapToolResult) into render-ready
	 * data, or null when it doesn't match this tool's expected shape. */
	parse(result: unknown): unknown;
	render(data: unknown): ReactNode;
}

// `data as T` below is a closed type-erasure box: `parse` and `render` are
// always built from the SAME schema/render pair in `entry`, so the cast can
// never see a mismatched value — there's no `unknown`-typed public API that
// lets a caller mix parse output from one entry with render from another.
// Exported so sibling registries (e.g. finance/finance-renderers.tsx) can
// build their own ToolResultRenderer entries the same way.
export function entry<T>(
	schema: ZodType<T>,
	render: (data: T) => ReactNode
): ToolResultRenderer {
	return {
		parse: (result: unknown) => {
			const parsed = schema.safeParse(unwrapToolResult(result));
			return parsed.success ? parsed.data : null;
		},
		render: (data: unknown) => render(data as T),
	};
}

// Per-ELEMENT tolerant list parse: scraped X data is messy (retweets, quotes,
// edited/edge-case tweets), so a single malformed item must not blank the whole
// render the way `z.array(schema)` would — validate each element and keep the
// good ones. Only a fully-unparseable result (a non-array, or an array where
// EVERY element fails — i.e. the shape is wrong, not just one stray item) falls
// back to the raw tool block.
export function listEntry<T>(
	elementSchema: ZodType<T>,
	render: (data: T[]) => ReactNode
): ToolResultRenderer {
	return {
		parse: (result: unknown) => {
			const unwrapped = unwrapToolResult(result);
			if (!Array.isArray(unwrapped)) {
				return null;
			}
			const valid: T[] = [];
			for (const item of unwrapped) {
				const parsed = elementSchema.safeParse(item);
				if (parsed.success) {
					valid.push(parsed.data);
				}
			}
			if (unwrapped.length > 0 && valid.length === 0) {
				return null;
			}
			return valid;
		},
		render: (data: unknown) => render(data as T[]),
	};
}

function ItemList<T>({
	items,
	renderItem,
}: {
	items: T[];
	renderItem: (item: T) => ReactNode;
}) {
	const visible = items.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = items.length - visible.length;
	return (
		<div className="flex flex-col gap-2">
			{visible.map(renderItem)}
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</div>
	);
}

function renderTweetList(tweets: NormalizedTweetData[]): ReactNode {
	return (
		<ItemList
			items={tweets}
			renderItem={(tweet) => (
				<TweetCardFromTweet key={tweet.tweetId} tweet={tweet} />
			)}
		/>
	);
}

function renderProfileList(profiles: NormalizedProfileData[]): ReactNode {
	return (
		<ItemList
			items={profiles}
			renderItem={(profile) => (
				<UserCard key={profile.screenName} profile={profile} />
			)}
		/>
	);
}

function renderSingleProfile(profile: NormalizedProfileData): ReactNode {
	return <UserCard profile={profile} />;
}

const TWEET_LIST_TOOLS = [
	"x_search_tweets",
	"x_user_tweets",
	"x_user_replies",
	"x_tweet_thread",
	"x_user_media",
] as const;

const PROFILE_LIST_TOOLS = ["x_followers", "x_following"] as const;

function tweetListEntries(): [string, ToolResultRenderer][] {
	return TWEET_LIST_TOOLS.map((name) => [
		name,
		listEntry<NormalizedTweetData>(NormalizedTweetSchema, renderTweetList),
	]);
}

function profileListEntries(): [string, ToolResultRenderer][] {
	return PROFILE_LIST_TOOLS.map((name) => [
		name,
		listEntry<NormalizedProfileData>(
			NormalizedProfileSchema,
			renderProfileList
		),
	]);
}

/** Tool name → { parse, render } for tools with a rich chat-result component.
 * Unregistered tool names simply have no entry — callers fall back to the
 * existing raw-JSON tool block. */
export const TOOL_RESULT_RENDERERS: Record<string, ToolResultRenderer> = {
	...Object.fromEntries(tweetListEntries()),
	...Object.fromEntries(profileListEntries()),
	x_search_users: entry<NormalizedProfileData>(
		NormalizedProfileSchema,
		renderSingleProfile
	),
	...FINANCE_RENDERERS,
};

/** Rich-result dispatch: null means "no rich render available" — the tool
 * block keeps its raw-JSON UI. Wrapped by `cloudToolRegistry` below. */
export function renderToolResult(
	toolName: string,
	result: unknown
): ReactNode | null {
	const renderer = TOOL_RESULT_RENDERERS[toolName];
	if (!renderer) {
		return null;
	}
	const data = renderer.parse(result);
	return data === null ? null : renderer.render(data);
}

/** A registered genui card only ever runs against a completed, successful
 * call — errored and in-flight calls keep the plain JSON block (or its error
 * banner). Exact tool-name match; a result the entry's schema rejects makes
 * `render` return null, which the registry treats as "unclaimed" → default
 * card. Same gating `richResult` in packages/ui's tool.tsx used to apply. */
function matchesCloudGenui(tool: ToolInvocation): boolean {
	return (
		tool.status === "complete" &&
		!tool.isError &&
		tool.toolName in TOOL_RESULT_RENDERERS
	);
}

/** The cloud chat's tool-card registry (P1-T1) — threaded into the shared
 * chat components via `Conversation`'s `toolRegistry` prop. */
export const cloudToolRegistry: ToolRegistry = [
	{
		match: matchesCloudGenui,
		render: (tool) => renderToolResult(tool.toolName, tool.result),
	},
];
