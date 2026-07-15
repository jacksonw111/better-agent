import { Tabs, TabsList, TabsTrigger } from "@better-agent/ui/components/tabs";

// P2-T2: the workspace content pane's pill tab row. Chat is live; P4-T2 added
// Shell (the runShell one-shot command runner); P4-T3 added Files (the
// read-only fsList/fsRead tree); P4-T4 added Git (the minimal
// status/diff/commit panel). The row scrolls horizontally on narrow screens.

export type WorkspaceTabId = "chat" | "files" | "git" | "shell";

/** Enabled non-chat tabs (P4-T2: Shell; P4-T3: Files; P4-T4: Git). The pane
 * itself handles the "capability absent / no active session" empty state, so
 * the tab stays enabled unconditionally rather than gating on caps the tab
 * row can't see. */
const LIVE_TABS: { id: WorkspaceTabId; label: string }[] = [
	{ id: "files", label: "Files" },
	{ id: "git", label: "Git" },
	{ id: "shell", label: "Shell" },
];

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
			<TabsList className="no-scrollbar max-w-full justify-start overflow-x-auto">
				<TabsTrigger className="px-2.5" value="chat">
					Chat
				</TabsTrigger>
				{LIVE_TABS.map((tab) => (
					<TabsTrigger className="px-2.5" key={tab.id} value={tab.id}>
						{tab.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}
