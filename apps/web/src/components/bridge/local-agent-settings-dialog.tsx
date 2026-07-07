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
import { useEffect, useState } from "react";
import { toast } from "sonner";
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

/** The mutation that persists the edited config, invalidating the token list so
 * the detail page reflects the saved values. Only mounted while the dialog is
 * open (the host lazy-mounts it), so the panel that holds the trigger never
 * pays for the react-query wiring. */
function useUpdateConfig(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.updateTokenConfig.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				toast.success("Settings saved");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
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
	token,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	token: BridgeTokenRow;
}) {
	const [draft, setDraft] = useState<ConfigDraft>(() => toDraft(token.config));

	// Re-seed the draft whenever the dialog opens so it reflects the latest
	// persisted config (not a stale edit from a previous open).
	useEffect(() => {
		if (open) {
			setDraft(toDraft(token.config));
		}
	}, [open, token.config]);

	const save = useUpdateConfig(() => onOpenChange(false));

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
					</TabsList>
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
						<GeneralTab token={token} />
						<ConfigTab
							draft={draft}
							onDraft={setDraft}
							onSubmit={() =>
								save.mutate({ config: configFromDraft(draft), id: token.id })
							}
							pending={save.isPending}
							token={token}
						/>
					</div>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
