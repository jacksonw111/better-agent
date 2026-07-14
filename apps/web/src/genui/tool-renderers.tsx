import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { ToolRegistry } from "@better-agent/ui/components/chat/tool-registry";
import {
	entry,
	FINANCE_RENDERERS,
	listEntry,
	MAX_RENDERED_ITEMS,
	PdfLinkProvider,
	type ToolResultRenderer,
} from "@jacksonw111/finance-genui";
import type { ReactNode } from "react";
import { PdfLink } from "@/components/pdf/pdf-link";
import { TweetCardFromTweet } from "./tweet-card-node";
import { UserCard } from "./user-card";
import {
	type NormalizedProfileData,
	NormalizedProfileSchema,
	type NormalizedTweetData,
	NormalizedTweetSchema,
} from "./x-result-schemas";

// Re-exported for the chat-registry test, which asserts the "+N more" cutoff.
export { MAX_RENDERED_ITEMS };

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
 * block keeps its raw-JSON UI. Wrapped by `cloudToolRegistry` below. Finance
 * cards render PDF affordances through the injected `PdfLink`, so their output
 * is wrapped in a `PdfLinkProvider` supplying the web app's vault-backed link. */
export function renderToolResult(
	toolName: string,
	result: unknown
): ReactNode | null {
	const renderer = TOOL_RESULT_RENDERERS[toolName];
	if (!renderer) {
		return null;
	}
	const data = renderer.parse(result);
	if (data === null) {
		return null;
	}
	return (
		<PdfLinkProvider value={PdfLink}>{renderer.render(data)}</PdfLinkProvider>
	);
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
