import type { PtyOpenSpec } from "@better-agent/api/pty/frame";
import { describe, expect, it, vi } from "vitest";
import {
	agentSpawnEnv,
	buildAgentCommand,
	createSessionIdCapturer,
	immediateBindId,
	needsSessionCapture,
	resolveAgentKind,
} from "./agent-command";

const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function spec(over: Partial<PtyOpenSpec>): PtyOpenSpec {
	return { command: "claude", args: [], cwd: "/repo", ...over };
}

describe("buildAgentCommand — claude/pi (own-id)", () => {
	it("creates with --session-id on the first spawn", () => {
		const cmd = buildAgentCommand(
			spec({
				agentKind: "claude-code",
				agentSessionId: SID,
				agentSessionStarted: false,
			})
		);
		expect(cmd).toEqual({ command: "claude", args: ["--session-id", SID] });
	});

	it("resumes with --resume once the conversation exists", () => {
		const cmd = buildAgentCommand(
			spec({
				agentKind: "claude-code",
				agentSessionId: SID,
				agentSessionStarted: true,
			})
		);
		expect(cmd).toEqual({ command: "claude", args: ["--resume", SID] });
	});

	it("treats pi like claude (own-id)", () => {
		const cmd = buildAgentCommand(
			spec({
				command: "pi",
				agentKind: "pi",
				agentSessionId: SID,
				agentSessionStarted: true,
			})
		);
		expect(cmd).toEqual({ command: "pi", args: ["--resume", SID] });
	});

	it("falls back to a plain spawn when no id is bound (older client)", () => {
		const cmd = buildAgentCommand(spec({ command: "claude", args: [] }));
		expect(cmd).toEqual({ command: "claude", args: [] });
	});
});

describe("buildAgentCommand — codex/opencode (capture)", () => {
	it("spawns bare on the first spawn (id captured after)", () => {
		const cmd = buildAgentCommand(
			spec({
				command: "codex",
				agentKind: "codex",
				agentSessionId: null,
				agentSessionStarted: false,
			})
		);
		expect(cmd).toEqual({ command: "codex", args: [] });
	});

	it("resumes with `codex resume <capturedId>` once started", () => {
		const cmd = buildAgentCommand(
			spec({
				command: "codex",
				agentKind: "codex",
				agentSessionId: "cap-123",
				agentSessionStarted: true,
			})
		);
		expect(cmd).toEqual({ command: "codex", args: ["resume", "cap-123"] });
	});
});

describe("resolveAgentKind", () => {
	it("prefers the explicit agentKind", () => {
		expect(resolveAgentKind(spec({ command: "x", agentKind: "codex" }))).toBe(
			"codex"
		);
	});

	it("infers from the binary name when absent", () => {
		expect(resolveAgentKind(spec({ command: "claude" }))).toBe("claude-code");
		expect(resolveAgentKind(spec({ command: "/usr/bin/codex" }))).toBe("codex");
	});
});

describe("agentSpawnEnv — claude child-session marker cleaning", () => {
	it("strips CLAUDE_CODE* and CLAUDECODE for claude/pi", () => {
		const base = {
			PATH: "/bin",
			CLAUDECODE: "1",
			CLAUDE_CODE_CHILD_SESSION: "abc",
			CLAUDE_CODE_ENTRYPOINT: "cli",
		};
		const env = agentSpawnEnv(spec({ agentKind: "claude-code" }), base);
		expect(env?.CLAUDECODE).toBeUndefined();
		expect(env?.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
		expect(env?.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
		expect(env?.PATH).toBe("/bin");
	});

	it("does not mutate the base env object", () => {
		const base = { CLAUDECODE: "1", PATH: "/bin" };
		agentSpawnEnv(spec({ agentKind: "claude-code" }), base);
		expect(base.CLAUDECODE).toBe("1");
	});

	it("returns the base env unchanged for a capture runtime (inherit)", () => {
		const base = { CLAUDECODE: "1", PATH: "/bin" };
		expect(
			agentSpawnEnv(spec({ command: "codex", agentKind: "codex" }), base)
		).toBe(base);
	});
});

describe("immediateBindId / needsSessionCapture", () => {
	it("claude first spawn binds immediately to the pty id", () => {
		expect(
			immediateBindId(
				spec({
					agentKind: "claude-code",
					agentSessionId: SID,
					agentSessionStarted: false,
				})
			)
		).toBe(SID);
	});

	it("claude resume does not bind again", () => {
		expect(
			immediateBindId(
				spec({
					agentKind: "claude-code",
					agentSessionId: SID,
					agentSessionStarted: true,
				})
			)
		).toBeNull();
	});

	it("codex first spawn needs a capture; a resume does not", () => {
		expect(
			needsSessionCapture(
				spec({
					command: "codex",
					agentKind: "codex",
					agentSessionStarted: false,
				})
			)
		).toBe(true);
		expect(
			needsSessionCapture(
				spec({
					command: "codex",
					agentKind: "codex",
					agentSessionId: "cap-1",
					agentSessionStarted: true,
				})
			)
		).toBe(false);
	});
});

describe("createSessionIdCapturer", () => {
	it("fires once on the banner line and ignores later output", () => {
		const onCapture = vi.fn();
		const scan = createSessionIdCapturer(onCapture);
		scan(new TextEncoder().encode("OpenAI Codex v0.142.5\n"));
		scan(
			new TextEncoder().encode(
				"session id: 019fa2b0-f899-7493-bc33-e2855323cbd4\n"
			)
		);
		scan(
			new TextEncoder().encode(
				"session id: ffffffff-0000-0000-0000-000000000000\n"
			)
		);
		expect(onCapture).toHaveBeenCalledTimes(1);
		expect(onCapture).toHaveBeenCalledWith(
			"019fa2b0-f899-7493-bc33-e2855323cbd4"
		);
	});

	it("tolerates the id split across chunk boundaries", () => {
		const onCapture = vi.fn();
		const scan = createSessionIdCapturer(onCapture);
		scan(new TextEncoder().encode("session id: 019fa2b0-f899-7493"));
		scan(new TextEncoder().encode("-bc33-e2855323cbd4\n"));
		expect(onCapture).toHaveBeenCalledWith(
			"019fa2b0-f899-7493-bc33-e2855323cbd4"
		);
	});
});
