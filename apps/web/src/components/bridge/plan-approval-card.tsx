import { Button } from "@better-agent/ui/components/button";
import type {
	ApprovalBlockData,
	ApprovalOption,
} from "@better-agent/ui/components/chat/chat-blocks";
import { Response } from "@better-agent/ui/components/response";
import { CheckIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { ApprovalCountdown } from "./event-line";

// P1-T4: claude's plan-mode approval, inline. The claude-code adapter emits
// ExitPlanMode's tool-permission request as an ordinary approval event
// (`apps/bridge-cli/src/adapters/claude-code-approvals.ts`): title is
// `Use ${toolName}?`, `detail` is the JSON-serialized tool input (whose
// `plan` field carries the plan markdown), options are allow/deny. This card
// renders that plan as prose with Build/Revise actions instead of the generic
// `ApprovalLine`, mirroring claudecodeui's PlanDisplay (research doc §3.3).

const EXIT_PLAN_MODE_TITLE = "Use ExitPlanMode?";

/** `true` when an approval is claude's ExitPlanMode permission request.
 * Matched on the adapter's `Use ${toolName}?` title — the normalized approval
 * carries no separate toolName field (see claude-code-approvals.ts). */
export function isExitPlanModeApproval(event: ApprovalBlockData): boolean {
	return event.title === EXIT_PLAN_MODE_TITLE;
}

function planFieldOf(value: unknown): string | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const { plan } = value as Record<string, unknown>;
	return typeof plan === "string" && plan.trim() !== "" ? plan : null;
}

/** The plan markdown out of the approval's `detail` (the JSON-serialized
 * ExitPlanMode tool input), or `null` when absent/malformed — the card then
 * degrades to the bare "Ready to build?" prompt with no plan body. */
export function extractPlanText(detail: string | undefined): string | null {
	if (!detail) {
		return null;
	}
	try {
		return planFieldOf(JSON.parse(detail));
	} catch {
		return null;
	}
}

/** ⌘/Ctrl+Enter answers a still-pending card with its Build (allow) option.
 * Document-level so the card doesn't need focus; detached once answered. */
function useBuildShortcut(enabled: boolean, onBuild: () => void): void {
	useEffect(() => {
		if (!enabled) {
			return () => {
				// nothing to clean up: no listener was attached
			};
		}
		const onKeyDown = (keyEvent: KeyboardEvent) => {
			if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key === "Enter") {
				keyEvent.preventDefault();
				onBuild();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, onBuild]);
}

/** Build = the adapter's "allow" option, Revise = "deny" — with a positional
 * first/second fallback so an id rename degrades gracefully instead of
 * dropping the buttons. */
function planOptions(options: ApprovalOption[]): {
	build?: ApprovalOption;
	revise?: ApprovalOption;
} {
	return {
		build: options.find((option) => option.id === "allow") ?? options[0],
		revise: options.find((option) => option.id === "deny") ?? options[1],
	};
}

interface PlanActionRowProps {
	answeredOptionId?: string;
	build?: ApprovalOption;
	disabled: boolean;
	onBuild: () => void;
	onRevise: () => void;
	revise?: ApprovalOption;
}

/** The Build (primary, with its ⌘↩ hint) / Revise (outline) button pair —
 * split out of `PlanApprovalCard` purely to keep that component under the
 * repo's max-lines-per-function gate. Mirrors `ApprovalLine`'s chosen-check
 * treatment once `answeredOptionId` is set. */
function PlanActionRow({
	answeredOptionId,
	build,
	disabled,
	onBuild,
	onRevise,
	revise,
}: PlanActionRowProps) {
	const buildChosen = build !== undefined && answeredOptionId === build.id;
	const reviseChosen = revise !== undefined && answeredOptionId === revise.id;
	return (
		<div className="flex flex-wrap items-center gap-2 px-3 py-2">
			{build && (
				<Button disabled={disabled} onClick={onBuild} size="sm" type="button">
					{buildChosen && <CheckIcon className="size-3.5" />}
					Build
					<span aria-hidden className="text-xs opacity-60">
						⌘↩
					</span>
					{buildChosen && <span className="sr-only"> (chosen)</span>}
				</Button>
			)}
			{revise && (
				<Button
					disabled={disabled}
					onClick={onRevise}
					size="sm"
					type="button"
					variant="outline"
				>
					{reviseChosen && <CheckIcon className="size-3.5" />}
					Revise
					{reviseChosen && <span className="sr-only"> (chosen)</span>}
				</Button>
			)}
		</div>
	);
}

export interface PlanApprovalCardProps {
	/** Mirrors `ApprovalLineProps.answeredOptionId` — set once this request was
	 * answered (optimistically or via replay); disables both buttons. */
	answeredOptionId?: string;
	event: ApprovalBlockData;
	onAnswer?: (requestId: string, optionId: string) => void;
}

/**
 * The inline plan-approval card: "Ready to build?" header, the plan rendered
 * as markdown prose, the shared pending-countdown bar, and a Build (allow) /
 * Revise (deny) button pair. Answers round-trip through the exact same
 * approval decision channel as `ApprovalLine` — only the presentation
 * changes. ⌘/Ctrl+Enter triggers Build while the card is pending.
 */
export function PlanApprovalCard({
	answeredOptionId,
	event,
	onAnswer,
}: PlanApprovalCardProps) {
	const disabled = answeredOptionId !== undefined;
	const plan = extractPlanText(event.detail);
	const { build, revise } = planOptions(event.options);
	const answer = useCallback(
		(optionId?: string) => {
			if (optionId !== undefined) {
				onAnswer?.(event.requestId, optionId);
			}
		},
		[event.requestId, onAnswer]
	);
	const onBuild = useCallback(() => answer(build?.id), [answer, build?.id]);
	const onRevise = useCallback(() => answer(revise?.id), [answer, revise?.id]);
	useBuildShortcut(!disabled, onBuild);

	return (
		<div className="overflow-hidden rounded-md bg-muted/40 font-sans">
			<div className="flex flex-col gap-1.5 px-3 pt-2">
				<p className="font-medium text-sm">Ready to build?</p>
				{plan !== null && <Response>{plan}</Response>}
				{event.timeoutAt !== undefined && !disabled && (
					<ApprovalCountdown
						timeoutAt={event.timeoutAt}
						timeoutMs={event.timeoutMs}
					/>
				)}
			</div>
			<PlanActionRow
				answeredOptionId={answeredOptionId}
				build={build}
				disabled={disabled}
				onBuild={onBuild}
				onRevise={onRevise}
				revise={revise}
			/>
		</div>
	);
}
