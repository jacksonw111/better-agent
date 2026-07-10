import type {
	CanUseTool,
	PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalOption, NormalizedEvent } from "../normalize/types";
import { type ApprovalRegistry, presentApproval } from "./approvals";

// The claude-code adapter's tool-approval routing, split out of claude-code.ts
// to keep that file under the repo's 300-line gate. Turns each SDK
// tool-permission request into an approval event the web answers, backed by
// the shared `ApprovalRegistry` + RC-T4 fail-closed `presentApproval` contract.

const APPROVAL_OPTIONS: ApprovalOption[] = [
	{ id: "allow", label: "Allow" },
	{ id: "deny", label: "Deny" },
];

/** FIX2 (rc-final-review): the SDK's `PermissionResult` requires a `message`
 * on every `deny` — this is what an unanswered approval resolves to once the
 * shared RC-T4 timeout (`presentApproval`) gives up, same fail-closed
 * contract every other adapter's approvals already get. */
const APPROVAL_TIMEOUT_DENY_MESSAGE =
	"Timed out waiting for approval — denied.";

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export interface EventSink {
	push(event: NormalizedEvent): void;
}

// Turns each SDK tool-permission request into an approval event and blocks on
// the user's web decision (resolved via the handle's answerApproval). Backed
// by the shared `ApprovalRegistry` (not a bare requestId->resolver map) so
// `interrupt()`/`stop()` can retract every still-pending request through the
// same `retractPendingApprovals` helper the other adapters use.
//
// FIX2 (rc-final-review): routed through the shared RC-T4 fail-closed
// contract (`presentApproval`) exactly like codex/opencode/pi's approvals —
// this used to call `approvals.register` directly, with no timeout of its
// own. Combined with the RC-T5 watchdog pausing while an approval card is
// open (`session-watchdog.ts`'s `observeApprovalEvent`), an unanswered claude
// approval could hang the session indefinitely; now it resolves a visible
// DENY after `APPROVAL_TIMEOUT_MS`, same as every other adapter.
export function makeCanUseTool(
	events: EventSink,
	approvals: ApprovalRegistry
): CanUseTool {
	return (toolName, toolInput, options) => {
		const requestId = options.toolUseID;
		return new Promise<PermissionResult>((resolve) => {
			presentApproval({
				approvals,
				event: {
					kind: "approval",
					requestId,
					title: `Use ${toolName}?`,
					detail: safeJson(toolInput),
					options: APPROVAL_OPTIONS,
				},
				events,
				onAnswer: (optionId) => {
					resolve(
						optionId === "allow"
							? { behavior: "allow", updatedInput: toolInput }
							: { behavior: "deny", message: "Denied from the bridge." }
					);
				},
				onTimeout: () => {
					resolve({
						behavior: "deny",
						message: APPROVAL_TIMEOUT_DENY_MESSAGE,
					});
				},
			});
		});
	};
}
