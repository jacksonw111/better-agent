// R2-T2: codex's per-turn `setModel`/`setPermissionMode` controls plus the
// `turn/start` policy params they feed — split out of codex.ts purely to
// keep that file under the repo's 300-line limit. Unlike claude-code's SDK
// (which has live `session.setModel`/`session.setPermissionMode` control-
// channel calls) and opencode's ACP (`unstable_setSessionModel`/
// `session/set_mode`, both fire-and-forget RPCs), codex has no such live
// call at all — its nearest equivalents, `model`/`approval_policy`, are
// plain `turn/start` request fields. So "switching" here means: remember the
// new value and stamp it onto every subsequent `turn/start`, never
// restarting the thread.

import type { CodexStatusCache } from "./codex-status";

/**
 * RC-T4: gates codex's shell/patch execution — without these, `turn/start`
 * left codex on its config.toml defaults, which (unset) run genuinely
 * unsupervised. Verified against `codex-rs/protocol/src/protocol.rs`'s serde
 * renames (see docs/research/agent-config-codex.md) — the wire VALUES below
 * are confirmed from source, not guessed. `approval_policy: "untrusted"` is
 * the SAFEST of the three simple policies: only "known safe" read-only
 * commands auto-approve, everything else asks (`"on-request"` instead lets
 * the MODEL decide when to ask, which is less safe; `"never"` never asks at
 * all). `sandbox_policy: workspace-write` + `network_access: false` is the
 * SAFEST sandbox that still lets codex do real work: writes are confined to
 * the workspace and outbound network is off (`read-only` would block codex
 * from editing anything at all; `danger-full-access` has no restrictions).
 *
 * ASSUMPTION (unverified — no `codex` binary in this sandbox): the exact JSON
 * key CASING for these two top-level request fields. The doc confirms both
 * fields ride on `turn/start` (and `thread/start`) and quotes the Rust struct
 * field names verbatim as `approval_policy`/`sandbox_policy` (snake_case,
 * with no `#[serde(rename_all)]` noted on the enclosing request struct
 * itself, unlike the kebab-case enum VALUES which ARE explicitly renamed) —
 * so snake_case is used as-is here, but only a real binary run can rule out
 * an additional request-envelope-level camelCase rename layered on top.
 */
const CODEX_APPROVAL_POLICY = "untrusted";
const CODEX_SANDBOX_POLICY = {
	type: "workspace-write",
	network_access: false,
} as const;

/** R2-T2: the three `approval_policy` values codex's `turn/start` accepts —
 * mirrors `CODEX_SESSION_CAPABILITIES.permissionModes` in
 * session-capabilities.ts (keep the two in sync). ASSUMPTION (unverified —
 * no `codex` binary in this sandbox): no fourth value exists. */
export const CODEX_APPROVAL_POLICIES = [
	"untrusted",
	"on-request",
	"never",
] as const;

export type CodexApprovalPolicy = (typeof CODEX_APPROVAL_POLICIES)[number];

export function isCodexApprovalPolicy(
	value: string
): value is CodexApprovalPolicy {
	return (CODEX_APPROVAL_POLICIES as readonly string[]).includes(value);
}

/** The live, mutable per-session state `setModel`/`setPermissionMode` write
 * into and `codexTurnStartParams` reads back out of — one instance per
 * session, held in codex.ts's `start` closure. */
export interface CodexControlState {
	approvalPolicy: CodexApprovalPolicy;
	model?: string;
}

/** `approvalPolicy` defaults to `CODEX_APPROVAL_POLICY` ("untrusted", the
 * safest of the three — see its doc comment) until `setPermissionMode`
 * overrides it; `model` seeds from the session's persisted startup config
 * (if any), so a turn/start right after start already carries it. */
export function createCodexControlState(
	initialModel?: string
): CodexControlState {
	return { approvalPolicy: CODEX_APPROVAL_POLICY, model: initialModel };
}

/** Builds `turn/start`'s policy-and-model fields from the current control
 * state — `model` is omitted entirely (not sent as `undefined`) when unset,
 * matching `threadStartParams`'s existing convention in codex.ts. */
export function codexTurnStartParams(state: CodexControlState): {
	approval_policy: CodexApprovalPolicy;
	model?: string;
	sandbox_policy: typeof CODEX_SANDBOX_POLICY;
} {
	return state.model
		? {
				approval_policy: state.approvalPolicy,
				sandbox_policy: CODEX_SANDBOX_POLICY,
				model: state.model,
			}
		: {
				approval_policy: state.approvalPolicy,
				sandbox_policy: CODEX_SANDBOX_POLICY,
			};
}

/** The `setModel` control (R2-T2 item 2): codex has no live model-switch
 * call, so this just stores the chosen id for the NEXT `turn/start` (no
 * restart) and mirrors it onto the `getStatus` cache so a snapshot taken
 * before the next turn already reflects it. */
export function makeCodexSetModel(
	state: CodexControlState,
	statusCache: CodexStatusCache
): (model: string) => void {
	return (model: string) => {
		state.model = model;
		statusCache.model = model;
	};
}

/** The `setPermissionMode` control (R2-T2 item 3): validates against
 * `CODEX_APPROVAL_POLICIES` before storing it for the NEXT `turn/start` — an
 * unrecognized value is silently ignored (ASSUMPTION per the brief: no visible
 * error event, mirroring claude-code's `isPermissionMode` guard in
 * claude-code.ts, which degrades the same way). `sandbox_policy` is untouched. */
export function makeCodexSetPermissionMode(
	state: CodexControlState
): (mode: string) => void {
	return (mode: string) => {
		if (isCodexApprovalPolicy(mode)) {
			state.approvalPolicy = mode;
		}
	};
}
