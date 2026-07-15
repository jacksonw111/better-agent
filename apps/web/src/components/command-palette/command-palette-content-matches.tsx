import { CommandGroup, CommandItem } from "@better-agent/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { FileSearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	bridgeResumeCliCommandFor,
	PLACEHOLDER_TOKEN,
} from "@/components/bridge/local-agent-join";
import type { SessionSearchHit } from "@/components/bridge/session-search-events";
import {
	type SessionSearchChannel,
	useSessionSearchChannel,
} from "@/components/bridge/session-search-store";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import type { WorkspaceCommandTarget } from "./command-palette-store";

// P4-T5: the sessions page's "内容匹配" group — a debounced full-text search
// over the CURRENT workspace agent's on-disk session transcripts, answered by
// the CLI over the search channel the mounted Terminal publishes (see
// session-search-store.ts). The hits reference the AGENT's own session ids
// (not bridge session rows), so selecting one copies the exact `--resume`
// command — the same affordance as past-conversations.tsx — instead of
// navigating.

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_CHARS = 2;

interface ContentSearchState {
	failed: boolean;
	hits: SessionSearchHit[];
	partial: boolean;
	searching: boolean;
}

const IDLE: ContentSearchState = {
	failed: false,
	hits: [],
	partial: false,
	searching: false,
};

/** Fires a debounced content search whenever `query` settles for
 * SEARCH_DEBOUNCE_MS; stale replies (a newer query already typed, or the
 * palette re-rendered) are dropped via the cleanup flag. */
function useSessionContentSearch(
	query: string,
	channel: SessionSearchChannel | null
): ContentSearchState {
	const [state, setState] = useState(IDLE);
	const enabled = channel?.enabled === true;
	useEffect(() => {
		const active =
			enabled && channel !== null && query.length >= MIN_QUERY_CHARS;
		if (active) {
			setState((previous) => ({ ...previous, failed: false, searching: true }));
		} else {
			setState(IDLE);
		}
		let stale = false;
		const fire = () => {
			channel
				?.search(query)
				.then((result) => {
					if (!stale) {
						setState({
							failed: false,
							hits: result.hits,
							partial: result.partial,
							searching: false,
						});
					}
				})
				.catch(() => {
					if (!stale) {
						setState({ ...IDLE, failed: true });
					}
				});
		};
		const timer = active ? setTimeout(fire, SEARCH_DEBOUNCE_MS) : undefined;
		return () => {
			stale = true;
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		};
	}, [enabled, channel, query]);
	return state;
}

const COPY_FAILED_MESSAGE = "复制失败 — 请重试";

/** One matched session: title + first snippet; selecting copies the resume
 * command (past-conversations.tsx semantics — no one-click relaunch). The
 * palette filters items by `value`, so the query itself rides as a keyword to
 * keep every CLI-confirmed match visible. */
function ContentMatchItem({
	command,
	hit,
	onRun,
	query,
}: {
	command: string;
	hit: SessionSearchHit;
	onRun: (action: () => void) => void;
	query: string;
}) {
	const snippet = hit.snippets[0]?.text ?? "";
	const copy = () => {
		navigator.clipboard
			.writeText(command)
			.then(() => toast.success("已复制恢复命令"))
			.catch(() => toast.error(COPY_FAILED_MESSAGE));
	};
	return (
		<CommandItem
			keywords={[query]}
			onSelect={() => onRun(copy)}
			value={`content-match ${hit.id} ${hit.title}`}
		>
			<FileSearchIcon />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{hit.title}</span>
				{snippet !== "" && (
					<span className="truncate text-muted-foreground text-xs">
						{snippet}
					</span>
				)}
			</div>
		</CommandItem>
	);
}

/** A non-actionable status row (loading / empty / partial / error) — carries
 * the query as a keyword so cmdk's filter never hides it. */
function ContentStatusItem({ query, text }: { query: string; text: string }) {
	return (
		<CommandItem disabled keywords={[query]} value={`content-status ${text}`}>
			<span className="text-muted-foreground text-xs">{text}</span>
		</CommandItem>
	);
}

function workspaceAgentKind(
	tokens: BridgeTokenRow[] | undefined,
	tokenId: string
): BridgeTokenRow["agentKind"] {
	return (
		tokens?.find((token) => token.id === tokenId)?.agentKind ?? "claude-code"
	);
}

/** The loading/empty/error/partial rows accompanying the hit items. */
function ContentStatusRows({
	query,
	state,
}: {
	query: string;
	state: ContentSearchState;
}) {
	const showEmpty =
		!(state.searching || state.failed) && state.hits.length === 0;
	return (
		<>
			{state.searching && state.hits.length === 0 && (
				<ContentStatusItem query={query} text="正在搜索会话内容…" />
			)}
			{showEmpty && <ContentStatusItem query={query} text="无内容匹配" />}
			{state.failed && (
				<ContentStatusItem query={query} text="内容搜索失败 — 请重试" />
			)}
			{state.partial && state.hits.length > 0 && (
				<ContentStatusItem
					query={query}
					text="结果可能不完整（已达扫描上限）"
				/>
			)}
		</>
	);
}

/** The "内容匹配" group under the palette's sessions page — rendered only
 * inside a workspace whose CLI reported the search capability, once the query
 * is long enough to be worth a scan. */
export function SessionContentMatches({
	onRun,
	query,
	workspace,
}: {
	onRun: (action: () => void) => void;
	query: string;
	workspace: WorkspaceCommandTarget;
}) {
	const channel = useSessionSearchChannel();
	const trimmed = query.trim();
	const state = useSessionContentSearch(trimmed, channel);
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	if (!(channel?.enabled === true && trimmed.length >= MIN_QUERY_CHARS)) {
		return null;
	}
	const agentKind = workspaceAgentKind(tokens.data, workspace.tokenId);
	return (
		<CommandGroup heading="内容匹配">
			{state.hits.map((hit) => (
				<ContentMatchItem
					command={bridgeResumeCliCommandFor(
						agentKind,
						PLACEHOLDER_TOKEN,
						hit.cwd,
						hit.id
					)}
					hit={hit}
					key={hit.id}
					onRun={onRun}
					query={trimmed}
				/>
			))}
			<ContentStatusRows query={trimmed} state={state} />
		</CommandGroup>
	);
}
