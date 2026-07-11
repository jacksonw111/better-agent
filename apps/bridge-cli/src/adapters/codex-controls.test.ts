import { describe, expect, it } from "vitest";
import {
	codexTurnStartParams,
	createCodexControlState,
	isCodexApprovalPolicy,
	makeCodexSetModel,
	makeCodexSetPermissionMode,
} from "./codex-controls";
import type { CodexStatusCache } from "./codex-status";

describe("createCodexControlState / codexTurnStartParams", () => {
	it("defaults approvalPolicy to untrusted and omits model when none was seeded", () => {
		const state = createCodexControlState();
		expect(codexTurnStartParams(state)).toEqual({
			approval_policy: "untrusted",
			sandbox_policy: { type: "workspace-write", network_access: false },
		});
	});

	it("seeds model from the persisted startup config and carries it on turn/start", () => {
		const state = createCodexControlState("gpt-5-codex");
		expect(codexTurnStartParams(state)).toEqual({
			approval_policy: "untrusted",
			sandbox_policy: { type: "workspace-write", network_access: false },
			model: "gpt-5-codex",
		});
	});
});

describe("isCodexApprovalPolicy", () => {
	it("accepts exactly the three documented values", () => {
		expect(isCodexApprovalPolicy("untrusted")).toBe(true);
		expect(isCodexApprovalPolicy("on-request")).toBe(true);
		expect(isCodexApprovalPolicy("never")).toBe(true);
	});

	it("rejects anything else", () => {
		expect(isCodexApprovalPolicy("bypassPermissions")).toBe(false);
		expect(isCodexApprovalPolicy("")).toBe(false);
	});
});

describe("makeCodexSetModel", () => {
	it("stores the model on the control state and mirrors it onto the status cache", () => {
		const state = createCodexControlState();
		const statusCache: CodexStatusCache = {};
		const setModel = makeCodexSetModel(state, statusCache);

		setModel("gpt-5.4");

		expect(state.model).toBe("gpt-5.4");
		expect(statusCache.model).toBe("gpt-5.4");
		expect(codexTurnStartParams(state)).toEqual({
			approval_policy: "untrusted",
			sandbox_policy: { type: "workspace-write", network_access: false },
			model: "gpt-5.4",
		});
	});
});

describe("makeCodexSetPermissionMode", () => {
	it("stores a valid mode for the next turn/start", () => {
		const state = createCodexControlState();
		makeCodexSetPermissionMode(state)("never");

		expect(state.approvalPolicy).toBe("never");
		expect(codexTurnStartParams(state).approval_policy).toBe("never");
	});

	it("ignores an invalid mode, leaving the previous policy in place", () => {
		const state = createCodexControlState();
		makeCodexSetPermissionMode(state)("bypassPermissions");

		expect(state.approvalPolicy).toBe("untrusted");
	});
});
