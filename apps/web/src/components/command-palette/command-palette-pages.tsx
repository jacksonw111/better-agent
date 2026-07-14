import {
	CommandGroup,
	CommandItem,
	CommandShortcut,
} from "@better-agent/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	LaptopIcon,
	MessageSquareIcon,
	PanelsTopLeftIcon,
	SearchIcon,
	SettingsIcon,
} from "lucide-react";
import { localAgentDisplayName } from "@/components/bridge/local-agent-format";
import { deriveLocalAgentEntries } from "@/components/bridge/local-agent-join";
import type { WorkspaceTabId } from "@/components/bridge/local-agent-workspace-tabs";
import { WEB_NAV_ITEMS } from "@/components/nav-items";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import type { WorkspaceCommandTarget } from "./command-palette-store";

// P2-T3: the palette's pages. `PalettePageId` is the page-stack vocabulary —
// P4 adds "files" / "commits" here and a matching page component, nothing
// else changes in the shell (command-palette.tsx).

export type PalettePageId = "sessions";

/** Runs an item's action and closes the palette (supplied by the shell). */
type RunAction = (action: () => void) => void;

/** First page of sessions for the palette, from the SAME query the workspace
 * sidebar polls when scoped to a token (shared react-query cache, so it's
 * warm inside /local/$tokenId). Only loaded rows are searchable — fine for
 * P2; P4's cross-session search replaces this. */
function usePaletteSessions(
	scopeTokenId: string | undefined
): BridgeSessionRow[] {
	const query = useQuery(
		orpc.bridge.listSessions.queryOptions({
			input: scopeTokenId ? { tokenId: scopeTokenId } : {},
		})
	);
	const rows = query.data?.sessions ?? [];
	return scopeTokenId
		? rows.filter((row) => row.tokenId === scopeTokenId)
		: rows;
}

/** Tab-switch + settings items for the CURRENTLY mounted workspace; the
 * group is absent entirely outside /local/$tokenId. Files/Git/Shell mirror
 * the tab row's disabled P4 placeholders. */
const WORKSPACE_TAB_ITEMS: readonly {
	disabled: boolean;
	id: WorkspaceTabId;
	label: string;
}[] = [
	{ disabled: false, id: "chat", label: "Chat" },
	{ disabled: true, id: "files", label: "Files" },
	{ disabled: true, id: "git", label: "Git" },
	{ disabled: true, id: "shell", label: "Shell" },
];

function WorkspaceCommandGroup({
	onRun,
	workspace,
}: {
	onRun: RunAction;
	workspace: WorkspaceCommandTarget;
}) {
	return (
		<CommandGroup heading="Workspace">
			{WORKSPACE_TAB_ITEMS.map((tab) => (
				<CommandItem
					disabled={tab.disabled}
					key={tab.id}
					onSelect={() => onRun(() => workspace.setTab(tab.id))}
					value={`switch to ${tab.label} tab`}
				>
					<PanelsTopLeftIcon />
					Switch to {tab.label} tab
					{tab.disabled && <CommandShortcut>P4</CommandShortcut>}
				</CommandItem>
			))}
			<CommandItem
				onSelect={() => onRun(workspace.openSettings)}
				value="agent settings"
			>
				<SettingsIcon />
				Agent settings…
			</CommandItem>
		</CommandGroup>
	);
}

/** One item per non-revoked bridge token, labeled by the shared display-name
 * helper (token name → latest-session label → "Untitled"). */
function AgentsCommandGroup({ onRun }: { onRun: RunAction }) {
	const navigate = useNavigate();
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = usePaletteSessions(undefined);
	const entries = deriveLocalAgentEntries(tokens.data ?? [], sessions);
	return (
		<CommandGroup heading="Local agents">
			{entries.map((entry) => (
				<CommandItem
					key={entry.token.id}
					keywords={[entry.token.agentKind]}
					onSelect={() =>
						onRun(() =>
							navigate({
								params: { tokenId: entry.token.id },
								to: "/local/$tokenId",
							})
						)
					}
					value={`open agent ${localAgentDisplayName(entry)} ${entry.token.id}`}
				>
					<LaptopIcon />
					<span className="truncate">{localAgentDisplayName(entry)}</span>
				</CommandItem>
			))}
		</CommandGroup>
	);
}

function NavigateCommandGroup({ onRun }: { onRun: RunAction }) {
	const navigate = useNavigate();
	return (
		<CommandGroup heading="Go to">
			{WEB_NAV_ITEMS.map((item) => (
				<CommandItem
					key={item.to}
					onSelect={() => onRun(() => navigate({ to: item.to }))}
					value={`go to ${item.label}`}
				>
					<item.icon />
					{item.label}
				</CommandItem>
			))}
		</CommandGroup>
	);
}

/** The root page: workspace actions (when inside one), the sessions
 * sub-page entry, agent navigation, and app navigation. */
export function RootCommandPage({
	onPush,
	onRun,
	workspace,
}: {
	onPush: (page: PalettePageId) => void;
	onRun: RunAction;
	workspace: WorkspaceCommandTarget | null;
}) {
	return (
		<>
			{workspace && (
				<WorkspaceCommandGroup onRun={onRun} workspace={workspace} />
			)}
			<CommandGroup heading="Sessions">
				<CommandItem
					onSelect={() => onPush("sessions")}
					value="search sessions"
				>
					<SearchIcon />
					Search sessions…
				</CommandItem>
			</CommandGroup>
			<AgentsCommandGroup onRun={onRun} />
			<NavigateCommandGroup onRun={onRun} />
		</>
	);
}

/** The sessions sub-page: the current agent's sessions inside a workspace,
 * otherwise the user's recent sessions across agents. Searchable by label
 * and id; selecting deep-links to /local/$tokenId?session=<id>. */
export function SessionsCommandPage({
	onRun,
	workspace,
}: {
	onRun: RunAction;
	workspace: WorkspaceCommandTarget | null;
}) {
	const navigate = useNavigate();
	const sessions = usePaletteSessions(workspace?.tokenId);
	return (
		<CommandGroup
			heading={workspace ? "Sessions — this agent" : "Recent sessions"}
		>
			{sessions.map((session) => (
				<CommandItem
					key={session.id}
					keywords={[session.id]}
					onSelect={() =>
						onRun(() =>
							navigate({
								params: { tokenId: session.tokenId },
								search: { session: session.id },
								to: "/local/$tokenId",
							})
						)
					}
					value={`session ${session.label} ${session.id}`}
				>
					<MessageSquareIcon />
					<span className="truncate">{session.label}</span>
				</CommandItem>
			))}
		</CommandGroup>
	);
}
