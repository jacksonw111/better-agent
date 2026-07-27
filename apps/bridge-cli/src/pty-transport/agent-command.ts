// P25-C: bind a pty session to the underlying agent's RESUMABLE conversation
// id, so a respawn after the process/CLI died resumes the real conversation
// instead of starting fresh. All rules are the real-machine spike's tested
// conclusions — see docs/research/2026-07-27-agent-session-binding-spike.md.
//
//   claude / pi  — the resumable id IS our pty id. First spawn creates it with
//                  `--session-id <id>`; a respawn resumes with `--resume <id>`
//                  (`--session-id` is create-only and errors on reuse). Their
//                  child-session env markers must be stripped or claude silently
//                  stops persisting the transcript and can't resume.
//   codex / open — the agent generates its own id; we CAPTURE it from startup
//                  output on the first spawn, then `<bin> resume <capturedId>`.
//
// The choice is driven by the OPEN spec's binding fields (server-populated),
// never by inspecting disk: `agentSessionStarted` says the conversation exists.

import type { PtyOpenSpec } from "@better-agent/api/pty/frame";

/** Runtimes whose resumable id is our own pty id (`--session-id` / `--resume`). */
const OWN_ID_KINDS = new Set(["claude-code", "pi"]);
/** Runtimes that mint their own id we must capture, then `<bin> resume <id>`. */
const CAPTURE_KINDS = new Set(["codex", "opencode"]);

/** Best-effort agentKind from the binary name, for an OPEN spec that predates
 * the P25-C binding fields (older client) — keeps a plain spawn working. */
function inferKind(command: string): string {
	const base = command.split("/").pop() ?? command;
	if (base.startsWith("claude")) {
		return "claude-code";
	}
	if (base === "pi") {
		return "pi";
	}
	if (base === "codex") {
		return "codex";
	}
	if (base === "opencode") {
		return "opencode";
	}
	return base;
}

/** The runtime this spec targets — its explicit `agentKind`, else inferred. */
export function resolveAgentKind(spec: PtyOpenSpec): string {
	return spec.agentKind ?? inferKind(spec.command);
}

export interface AgentCommand {
	args: string[];
	command: string;
}

/** The exact command to spawn for this session: create on the first spawn,
 * resume once the conversation exists (`agentSessionStarted`). Falls back to a
 * plain spawn when the spec carries no bindable id (older client). */
export function buildAgentCommand(spec: PtyOpenSpec): AgentCommand {
	const kind = resolveAgentKind(spec);
	const started = spec.agentSessionStarted === true;
	const extra = spec.args ?? [];
	const id = spec.agentSessionId ?? undefined;

	if (OWN_ID_KINDS.has(kind)) {
		if (!id) {
			return { command: spec.command, args: [...extra] };
		}
		return started
			? { command: spec.command, args: ["--resume", id, ...extra] }
			: { command: spec.command, args: ["--session-id", id, ...extra] };
	}
	if (CAPTURE_KINDS.has(kind) && started && id) {
		return { command: spec.command, args: ["resume", id, ...extra] };
	}
	// codex/opencode first spawn (capture after), or an unknown runtime.
	return { command: spec.command, args: [...extra] };
}

// Env markers that make claude think it is a NESTED child session and silently
// disable transcript persistence — which breaks `--resume` with no error. Any
// `CLAUDE_CODE*` var plus `CLAUDECODE` is stripped before a claude/pi spawn.
function isClaudeChildMarker(key: string): boolean {
	return key.startsWith("CLAUDE_CODE") || key === "CLAUDECODE";
}

/** The environment to spawn this session under: for claude/pi a copy of `base`
 * with the child-session markers removed; for every other runtime `base`
 * unchanged (which for the default `process.env` is just the inherited env). */
export function agentSpawnEnv(
	spec: PtyOpenSpec,
	base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
	if (!OWN_ID_KINDS.has(resolveAgentKind(spec))) {
		return base;
	}
	const cleaned: NodeJS.ProcessEnv = { ...base };
	for (const key of Object.keys(cleaned)) {
		if (isClaudeChildMarker(key)) {
			delete cleaned[key];
		}
	}
	return cleaned;
}

/** For claude/pi the resumable id is known up front (= our pty id), so on the
 * first spawn we can report it immediately; returns that id, else null. */
export function immediateBindId(spec: PtyOpenSpec): string | null {
	const kind = resolveAgentKind(spec);
	if (
		OWN_ID_KINDS.has(kind) &&
		spec.agentSessionStarted !== true &&
		spec.agentSessionId
	) {
		return spec.agentSessionId;
	}
	return null;
}

/** Whether this spawn must capture a codex/opencode-generated id from output
 * (a first spawn of a capture runtime; a resume already has the id). */
export function needsSessionCapture(spec: PtyOpenSpec): boolean {
	return (
		CAPTURE_KINDS.has(resolveAgentKind(spec)) &&
		spec.agentSessionStarted !== true
	);
}

// The startup banner line codex/opencode print, e.g. `session id: <uuid>`.
// Loose + case-insensitive so a version tweak to the label still matches.
const SESSION_ID_RE =
	/session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const CAPTURE_BUFFER_CAP = 8192;

/** A one-shot scanner over raw pty output bytes that fires `onCapture` with the
 * agent's generated session id the first time the startup banner appears, then
 * ignores everything (we transpar­ently pass bytes through; this only sniffs).
 * Tolerant of chunk boundaries via a small bounded rolling buffer. */
export function createSessionIdCapturer(
	onCapture: (agentSessionId: string) => void
): (chunk: Uint8Array) => void {
	const decoder = new TextDecoder();
	let buffer = "";
	let done = false;
	return (chunk: Uint8Array) => {
		if (done) {
			return;
		}
		buffer += decoder.decode(chunk, { stream: true });
		const match = buffer.match(SESSION_ID_RE);
		if (match?.[1]) {
			done = true;
			buffer = "";
			onCapture(match[1]);
			return;
		}
		if (buffer.length > CAPTURE_BUFFER_CAP) {
			buffer = buffer.slice(-CAPTURE_BUFFER_CAP);
		}
	};
}
