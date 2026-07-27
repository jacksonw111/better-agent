import type { PtyOpenSpec } from "@better-agent/api/pty/frame";
import { cn } from "@better-agent/ui/lib/utils";
import { useState } from "react";
import { PtyTerminal } from "./pty-terminal";
import { WorkspaceFilesPane } from "./workspace-files-pane";
import { WorkspaceGitPane } from "./workspace-git-pane";
import { WorkspaceShellPane } from "./workspace-shell-pane";

// DP-WS: the terminal page's tab layout — Terminal | Files | Git | Shell. The
// terminal (xterm) is ALWAYS mounted and never remounted on a tab switch: an
// inactive tab hides it with CSS (`hidden`), so the same xterm instance and its
// live byte stream survive untouched — the panes never touch the hot path. The
// side panes are LAZY: a pane mounts the first time its tab is opened and then
// stays mounted (also CSS-hidden when inactive) so its state (Files path, Shell
// history) persists across switches. Each pane's query is on-demand — it fires
// on that first mount and refetches only on the pane's own refresh, never as a
// stream.

type WorkspaceTab = "terminal" | "files" | "git" | "shell";

const TABS: { id: WorkspaceTab; label: string }[] = [
	{ id: "terminal", label: "Terminal" },
	{ id: "files", label: "Files" },
	{ id: "git", label: "Git" },
	{ id: "shell", label: "Shell" },
];

function TabBar({
	active,
	onSelect,
}: {
	active: WorkspaceTab;
	onSelect: (tab: WorkspaceTab) => void;
}) {
	return (
		<div
			className="flex items-center gap-1 border-border/60 border-b"
			role="tablist"
		>
			{TABS.map((tab) => (
				<button
					aria-selected={active === tab.id}
					className={cn(
						"-mb-px border-b-2 px-3 py-1.5 font-medium text-sm transition-colors",
						active === tab.id
							? "border-foreground text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground"
					)}
					data-testid={`workspace-tab-${tab.id}`}
					key={tab.id}
					onClick={() => onSelect(tab.id)}
					role="tab"
					type="button"
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

/** Keeps an already-visited pane mounted, hiding it with CSS when inactive so
 * its state survives a tab switch. */
function PaneSlot({
	active,
	children,
}: {
	active: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className={active ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
			{children}
		</div>
	);
}

function WorkspacePanels({
	active,
	computerId,
	sessionId,
	spec,
	visited,
}: {
	active: WorkspaceTab;
	computerId: string;
	sessionId: string;
	spec?: PtyOpenSpec | null;
	visited: Set<WorkspaceTab>;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Always mounted — a hidden tab never unmounts or restarts the pty. */}
			<div
				className={
					active === "terminal" ? "flex min-h-0 flex-1 flex-col" : "hidden"
				}
			>
				<PtyTerminal
					computerId={computerId}
					sessionId={sessionId}
					spec={spec}
				/>
			</div>
			{visited.has("files") && (
				<PaneSlot active={active === "files"}>
					<WorkspaceFilesPane sessionId={sessionId} />
				</PaneSlot>
			)}
			{visited.has("git") && (
				<PaneSlot active={active === "git"}>
					<WorkspaceGitPane sessionId={sessionId} />
				</PaneSlot>
			)}
			{visited.has("shell") && (
				<PaneSlot active={active === "shell"}>
					<WorkspaceShellPane sessionId={sessionId} />
				</PaneSlot>
			)}
		</div>
	);
}

export function PtyWorkspaceTabs({
	computerId,
	sessionId,
	spec,
}: {
	computerId: string;
	sessionId: string;
	spec?: PtyOpenSpec | null;
}) {
	const [active, setActive] = useState<WorkspaceTab>("terminal");
	const [visited, setVisited] = useState<Set<WorkspaceTab>>(
		() => new Set<WorkspaceTab>(["terminal"])
	);
	const select = (tab: WorkspaceTab) => {
		setActive(tab);
		setVisited((prev) => {
			if (prev.has(tab)) {
				return prev;
			}
			const next = new Set(prev);
			next.add(tab);
			return next;
		});
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<TabBar active={active} onSelect={select} />
			<WorkspacePanels
				active={active}
				computerId={computerId}
				sessionId={sessionId}
				spec={spec}
				visited={visited}
			/>
		</div>
	);
}
