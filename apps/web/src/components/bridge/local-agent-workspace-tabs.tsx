import { Tabs, TabsList, TabsTrigger } from "@better-agent/ui/components/tabs";

// P2-T2: the workspace content pane's pill tab row. Chat is live; P4-T2 added
// Shell (the runShell one-shot command runner); P4-T3 added Files (the
// read-only fsList/fsRead tree). Git remains a disabled placeholder until its
// P4 CLI channel lands. The row scrolls horizontally on narrow screens.

export type WorkspaceTabId = "chat" | "files" | "git" | "shell";

/** Enabled non-chat tabs (P4-T2: Shell; P4-T3: Files). The pane itself
 * handles the "capability absent / no active session" empty state, so the tab
 * stays enabled unconditionally rather than gating on caps the tab row can't
 * see. */
const LIVE_TABS: { id: WorkspaceTabId; label: string }[] = [
	{ id: "files", label: "Files" },
	{ id: "shell", label: "Shell" },
];

const PLACEHOLDER_TABS: { id: WorkspaceTabId; label: string }[] = [
	{ id: "git", label: "Git" },
];

/** Small "lands in P4" marker on each placeholder pill. */
function PhaseBadge() {
	return (
		<span className="rounded bg-muted-foreground/15 px-1 font-normal text-muted-foreground text-xs">
			P4
		</span>
	);
}

/** Controlled pill tab group. The CONTENT is deliberately not rendered via
 * tab panels — the workspace keeps the chat pane mounted in a hidden/block
 * container so future tab switches never remount the terminal. */
export function LocalAgentWorkspaceTabs({
	onChange,
	value,
}: {
	onChange: (tab: WorkspaceTabId) => void;
	value: WorkspaceTabId;
}) {
	return (
		<Tabs
			className="min-w-0"
			onValueChange={(next) => onChange(next as WorkspaceTabId)}
			value={value}
		>
			<TabsList className="max-w-full justify-start overflow-x-auto">
				<TabsTrigger className="px-2.5" value="chat">
					Chat
				</TabsTrigger>
				{LIVE_TABS.map((tab) => (
					<TabsTrigger className="px-2.5" key={tab.id} value={tab.id}>
						{tab.label}
					</TabsTrigger>
				))}
				{PLACEHOLDER_TABS.map((tab) => (
					<TabsTrigger
						className="gap-1 px-2.5"
						disabled
						key={tab.id}
						value={tab.id}
					>
						{tab.label}
						<PhaseBadge />
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}
