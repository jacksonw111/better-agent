import { CopyAction } from "@better-agent/ui/components/actions";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@better-agent/ui/components/tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssignedMemories } from "@/components/memory/assigned-memories";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import {
	type ConfigDraft,
	ConfigTab,
	configFromDraft,
	toDraft,
} from "./local-agent-config-form";
import { AGENT_KIND_LABEL } from "./local-agent-kind-icon";

const CODE_CLASS =
	"block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs";

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-3">
			<dt className="w-32 shrink-0 text-muted-foreground text-xs">{label}</dt>
			<dd className="min-w-0 flex-1 font-medium text-sm">{children}</dd>
		</div>
	);
}

function formatConfigSummary(config: BridgeTokenRow["config"]): string {
	if (!config) {
		return "Defaults";
	}
	const parts: string[] = [];
	if (config.effort) {
		parts.push(`effort: ${config.effort}`);
	}
	if (config.maxTurns !== undefined) {
		parts.push(`${config.maxTurns} turns`);
	}
	if (config.maxBudgetUsd !== undefined) {
		parts.push(`$${config.maxBudgetUsd} cap`);
	}
	return parts.length > 0 ? parts.join(" · ") : "Defaults";
}

function GeneralTab({ token }: { token: BridgeTokenRow }) {
	const raw = token.token;
	const created = new Date(token.createdAt);
	return (
		<TabsContent value="general">
			<dl className="flex flex-col gap-3">
				<Row label="Agent">{AGENT_KIND_LABEL[token.agentKind]}</Row>
				<Row label="Name">{token.name ?? "Untitled"}</Row>
				<Row label="Token">
					{raw ? (
						<div className="flex items-center gap-1.5">
							<code className={CODE_CLASS}>
								…{token.last4 ?? raw.slice(-4)}
							</code>
							<CopyAction label="Copy token" text={raw} />
						</div>
					) : (
						<span className="text-muted-foreground">—</span>
					)}
				</Row>
				<Row label="Token usage">{formatConfigSummary(token.config)}</Row>
				<Row label="Created">
					{created.toLocaleDateString(undefined, {
						year: "numeric",
						month: "short",
						day: "numeric",
					})}
				</Row>
			</dl>
		</TabsContent>
	);
}

/** The memories this local agent can search (M1): assign/unassign the user's
 * memories and toggle each link's read/read & write role. */
function MemoriesTab({ token }: { token: BridgeTokenRow }) {
	return (
		<TabsContent value="memories">
			<AssignedMemories target={{ tokenId: token.id }} />
		</TabsContent>
	);
}

/** The mutation that persists the edited config, invalidating the token list so
 * the detail page reflects the saved values. Only mounted while the dialog is
 * open (the host lazy-mounts it), so the panel that holds the trigger never
 * pays for the react-query wiring. Success feedback (plain "saved" vs. the
 * restart hint) is left to each call site's own `mutate(vars, { onSuccess })`
 * — see `showSaveFeedback` below — since only the caller knows whether this
 * particular save touched a field that needs a restart to apply. */
function useUpdateConfig(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.updateTokenConfig.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

const RESTART_FAILURE_MESSAGE = "Couldn't restart the agent — try again.";

/** Config fields the CLI only re-reads at session start (see
 * docs/research/agent-config-claude-code.md) — changing one of these needs a
 * restart to take effect. `model`/`permissionMode` are excluded: the CLI
 * applies those on its next control message, no restart needed (R2-a).
 * `skillIds` is included (R5-T2): skills are only written/applied at launch
 * today for every adapter — claude could live-reload them later, but until
 * then a skills edit always needs a restart, same as the startup-only fields
 * above. `mcpServerIds` is intentionally NOT here yet (R5-a predates this
 * distinction). */
const RESTART_REQUIRED_FIELDS = [
	"appendSystemPrompt",
	"effort",
	"maxBudgetUsd",
	"maxTurns",
	"skillIds",
] as const satisfies readonly (keyof ConfigDraft)[];

/** Whether this save touched a field from `RESTART_REQUIRED_FIELDS`, by
 * comparing against the draft as it stood when the dialog opened. */
function touchesNonLiveField(before: ConfigDraft, after: ConfigDraft): boolean {
	return RESTART_REQUIRED_FIELDS.some(
		(field) => before[field] !== after[field]
	);
}

/** The settings dialog's own "Restart now" trigger — same
 * `bridge.restartSession` request `use-bridge-terminal-actions.ts`'s
 * `restart` control uses (R3), called directly here since this dialog isn't
 * wired through `useBridgeTerminal`. */
function restartFromToast(sessionId: string): void {
	orpc.bridge.restartSession.call({ sessionId }).catch((error: unknown) => {
		const message =
			error instanceof Error ? error.message : RESTART_FAILURE_MESSAGE;
		toast.error(message);
	});
}

/** Save feedback: a plain "Settings saved" when the change only touched
 * live-applied fields, otherwise a restart hint — with a one-click "Restart
 * now" action when the dialog knows its live `sessionId` (opened from the
 * session header), or just the informational note pointing at the
 * terminal's own Restart button when it doesn't (opened from the connection
 * panel, before any session exists). */
function showSaveFeedback(restartNeeded: boolean, sessionId?: string): void {
	if (!restartNeeded) {
		toast.success("Settings saved");
		return;
	}
	if (!sessionId) {
		toast.success("Saved — restart the agent to apply", {
			description: "Use the Restart button in the session toolbar.",
		});
		return;
	}
	toast.success("Saved — restart the agent to apply", {
		action: {
			label: "Restart now",
			onClick: () => restartFromToast(sessionId),
		},
	});
}

/** Owns the draft state, the seed-on-open effect, and the save trigger
 * (which diffs the draft against its just-opened seed to decide whether to
 * show the restart hint — see `touchesNonLiveField`/`showSaveFeedback`
 * above). Split out purely to keep `LocalAgentSettingsDialog` itself under
 * the repo's max-lines-per-function gate. */
function useSettingsDraft(
	token: BridgeTokenRow,
	open: boolean,
	sessionId: string | undefined,
	onSaved: () => void
) {
	const [draft, setDraft] = useState<ConfigDraft>(() => toDraft(token.config));
	// The draft as it stood when the dialog opened, so a save can tell which
	// fields actually changed — not itself rendered, so a ref rather than
	// state.
	const initialDraftRef = useRef<ConfigDraft>(draft);

	// Re-seed the draft whenever the dialog opens so it reflects the latest
	// persisted config (not a stale edit from a previous open).
	useEffect(() => {
		if (open) {
			const seeded = toDraft(token.config);
			setDraft(seeded);
			initialDraftRef.current = seeded;
		}
	}, [open, token.config]);

	const save = useUpdateConfig(onSaved);
	const handleSubmit = () => {
		const restartNeeded = touchesNonLiveField(initialDraftRef.current, draft);
		save.mutate(
			{ config: configFromDraft(draft), id: token.id },
			{ onSuccess: () => showSaveFeedback(restartNeeded, sessionId) }
		);
	};

	return { draft, handleSubmit, pending: save.isPending, setDraft };
}

/**
 * Phase 4 Settings modal for a local agent: left tabs (General + the agent's
 * startup config), right content. Edits the token's persisted `config`
 * (appendSystemPrompt, effort, maxTurns, maxBudgetUsd — see
 * docs/research/agent-config-claude-code.md) which the bridge CLI fetches at
 * session start and applies (currently claude-code). Controlled
 * (`open`/`onOpenChange`) and trigger-less so the host can lazy-mount it.
 */
export function LocalAgentSettingsDialog({
	open,
	onOpenChange,
	sessionId,
	token,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The live session this token's terminal is currently showing, when this
	 * dialog is opened from the session header (terminal-header.tsx) — lets
	 * the restart hint offer a one-click "Restart now". Left undefined when
	 * opened from the connection panel (local-agent-connection-panel.tsx),
	 * which has no live session to restart. */
	sessionId?: string;
	token: BridgeTokenRow;
}) {
	const { draft, handleSubmit, pending, setDraft } = useSettingsDraft(
		token,
		open,
		sessionId,
		() => onOpenChange(false)
	);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex h-5/6 w-full flex-col gap-0 p-0 sm:max-w-7xl">
				<DialogHeader className="px-5 pt-5">
					<DialogTitle>Agent settings</DialogTitle>
				</DialogHeader>
				<Tabs
					className="flex min-h-0 flex-1 flex-row gap-4 px-5 pt-3 pb-5"
					defaultValue="general"
					orientation="vertical"
				>
					<TabsList className="h-fit w-44 shrink-0 flex-col items-stretch">
						<TabsTrigger value="general">General</TabsTrigger>
						<TabsTrigger value="config">Config</TabsTrigger>
						<TabsTrigger value="memories">Memories</TabsTrigger>
					</TabsList>
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
						<GeneralTab token={token} />
						<MemoriesTab token={token} />
						<ConfigTab
							draft={draft}
							onDraft={setDraft}
							onSubmit={handleSubmit}
							pending={pending}
							token={token}
						/>
					</div>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
