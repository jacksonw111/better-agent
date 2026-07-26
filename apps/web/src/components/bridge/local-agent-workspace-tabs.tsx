import { Tabs, TabsList, TabsTrigger } from "@better-agent/ui/components/tabs";

// P2-T2: the workspace content pane's pill tab row. Chat is the only live tab.
// TODO(P2-3 / Appendix A.4 #2): Shell/Files/Git were removed here because their
// panes were fed by the deleted structured event channel; they return once
// rewired onto a thin RPC transport. The WorkspaceTabId union keeps all four
// members so the ⌘K command palette (which lists Files/Git/Shell as disabled
// entries) still type-checks. The row scrolls horizontally on narrow screens.

export type WorkspaceTabId = "chat" | "files" | "git" | "shell";

/** Enabled non-chat tabs — none while the inspection panes are gated (P2-3). */
const LIVE_TABS: { id: WorkspaceTabId; label: string }[] = [];

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
