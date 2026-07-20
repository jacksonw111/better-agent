import { describe, expect, it } from "vitest";
import {
	foldSessionReadyEvent,
	initialSessionReadyFold,
	type SessionReadyFold,
	sessionReadyOf,
} from "./session-ready-fold";

// fix-caps-regression: the read-back folding (2068433) must NEVER fabricate a
// partial sessionReady — a `permission_mode_changed`/`model_changed` arriving
// before the `session_ready` handshake (SDK status push on resume, or a late
// history backfill reordering batches) previously produced a detail holding
// ONLY that field, wiping `capabilities` for every consumer: the Git/Files/
// Shell tabs fell back to "CLI 版本过旧" gating and the composer lost its
// model list. These tests pin the id-tracked fold that replaces it.

/** A full live handshake, as claude-code 0.7.x's session_ready carries. */
const CAPS = {
	approval: "gated",
	busyModes: ["queue", "interrupt"],
	fs: true,
	git: true,
	images: true,
	mcp: "live",
	modelSwitch: true,
	permissionModes: ["default", "acceptEdits", "plan", "dontAsk"],
	quota: true,
	sessionOps: ["list"],
	shell: true,
	skills: true,
	slashCommands: true,
	thinkingLevels: [],
	usage: "stream",
};

const READY_DETAIL = {
	capabilities: CAPS,
	cwd: "/repo",
	mcpServers: [{ name: "docs", status: "connected" }],
	model: "sonnet",
	models: ["sonnet", "opus"],
	permissionMode: "default",
	sessionId: "claude-1",
	skills: ["research"],
	slashCommands: ["compact"],
	tools: ["Bash"],
};

function ready(id: number, prev: SessionReadyFold = initialSessionReadyFold) {
	const next = foldSessionReadyEvent(prev, id, {
		detail: READY_DETAIL,
		status: "session_ready",
	});
	if (next === undefined) {
		throw new Error("session_ready must fold");
	}
	return next;
}

function fold(
	prev: SessionReadyFold,
	id: number,
	status: string,
	detail: unknown
): SessionReadyFold {
	return foldSessionReadyEvent(prev, id, { detail, status }) ?? prev;
}

describe("foldSessionReadyEvent before any session_ready", () => {
	it("stashes a read-back without fabricating a partial detail", () => {
		const state = fold(initialSessionReadyFold, 7, "permission_mode_changed", {
			permissionMode: "plan",
		});
		expect(sessionReadyOf(state)).toBeNull();
	});

	it("applies the stashed read-back once a LOWER-id session_ready backfills", () => {
		// The 乱序 resume case: the read-back (id 7) folded first, the handshake
		// (id 3) arrives late via poll/history backfill — the detail must be the
		// FULL handshake with the newer read-back's field on top.
		let state = fold(initialSessionReadyFold, 7, "permission_mode_changed", {
			permissionMode: "plan",
		});
		state = ready(3, state);
		const detail = sessionReadyOf(state);
		expect(detail?.capabilities).toEqual(CAPS);
		expect(detail?.models).toEqual(["sonnet", "opus"]);
		expect(detail?.permissionMode).toBe("plan");
	});

	it("returns undefined for a status that doesn't affect sessionReady", () => {
		expect(
			foldSessionReadyEvent(initialSessionReadyFold, 1, {
				detail: {},
				status: "turn_usage",
			})
		).toBeUndefined();
	});
});

describe("foldSessionReadyEvent after session_ready", () => {
	it("patches permissionMode while preserving every capability field", () => {
		const state = fold(ready(1), 2, "permission_mode_changed", {
			permissionMode: "acceptEdits",
		});
		const detail = sessionReadyOf(state);
		expect(detail?.permissionMode).toBe("acceptEdits");
		expect(detail?.capabilities).toEqual(CAPS);
		expect(detail?.models).toEqual(["sonnet", "opus"]);
		expect(detail?.tools).toEqual(["Bash"]);
		expect(detail?.sessionId).toBe("claude-1");
	});

	it("patches model while preserving the capability fields", () => {
		const state = fold(ready(1), 2, "model_changed", { model: "opus" });
		const detail = sessionReadyOf(state);
		expect(detail?.model).toBe("opus");
		expect(detail?.capabilities).toEqual(CAPS);
		expect(detail?.permissionMode).toBe("default");
	});

	it("leaves state untouched (same reference) for a malformed read-back", () => {
		const state = ready(1);
		expect(fold(state, 2, "permission_mode_changed", "not-an-object")).toBe(
			state
		);
		expect(fold(state, 2, "model_changed", {})).toBe(state);
	});
});

describe("foldSessionReadyEvent id ordering", () => {
	it("ignores a read-back OLDER than the handshake (late backfill)", () => {
		// A pre-init SDK status push (id 2) backfilling after the init handshake
		// (id 6) is stale — it must not regress the handshake's own value.
		const state = fold(ready(6), 2, "permission_mode_changed", {
			permissionMode: "plan",
		});
		expect(sessionReadyOf(state)?.permissionMode).toBe("default");
	});

	it("keeps the newest of two read-backs regardless of fold order", () => {
		let state = ready(1);
		state = fold(state, 5, "permission_mode_changed", {
			permissionMode: "plan",
		});
		state = fold(state, 3, "permission_mode_changed", {
			permissionMode: "acceptEdits",
		});
		expect(sessionReadyOf(state)?.permissionMode).toBe("plan");
	});

	it("drops obsolete patches when a NEWER session_ready replaces the base", () => {
		// Restart: a fresh handshake (id 10) supersedes the old session's applied
		// switch (id 5) — the menu must show the new session's startup mode.
		let state = ready(1);
		state = fold(state, 5, "permission_mode_changed", {
			permissionMode: "plan",
		});
		state = ready(10, state);
		expect(sessionReadyOf(state)?.permissionMode).toBe("default");
	});
});

describe("model_catalog (a model list that missed the handshake)", () => {
	/** A listless handshake — what a slow SDK control channel produces. */
	function readyWithoutModels(id: number): SessionReadyFold {
		const next = foldSessionReadyEvent(initialSessionReadyFold, id, {
			detail: { ...READY_DETAIL, model: undefined, models: undefined },
			status: "session_ready",
		});
		if (next === undefined) {
			throw new Error("session_ready must fold");
		}
		return next;
	}

	it("fills in the picker's list without touching the rest of the handshake", () => {
		const state = fold(readyWithoutModels(1), 4, "model_catalog", {
			models: ["sonnet", "opus"],
		});
		const detail = sessionReadyOf(state);
		expect(detail?.models).toEqual(["sonnet", "opus"]);
		// The capability handshake must survive it — the whole point of patching
		// rather than re-folding a second session_ready.
		expect(detail?.capabilities).toEqual(CAPS);
		expect(detail?.sessionId).toBe("claude-1");
	});

	it("loses to a NEWER session_ready and to a newer catalog", () => {
		let state = fold(readyWithoutModels(1), 4, "model_catalog", {
			models: ["stale"],
		});
		state = fold(state, 9, "model_catalog", { models: ["fresh"] });
		expect(sessionReadyOf(state)?.models).toEqual(["fresh"]);
		// A restart's handshake (id 12) supersedes the old session's catalog.
		state = ready(12, state);
		expect(sessionReadyOf(state)?.models).toEqual(READY_DETAIL.models);
	});

	it("ignores a malformed or empty catalog", () => {
		let state = fold(readyWithoutModels(1), 4, "model_catalog", {
			models: [],
		});
		expect(sessionReadyOf(state)?.models).toBeUndefined();
		state = fold(state, 5, "model_catalog", { models: "sonnet" });
		expect(sessionReadyOf(state)?.models).toBeUndefined();
	});
});
