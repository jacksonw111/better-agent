import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { CommandSink } from "./commands";
import { dispatchCommands, parseCommandText } from "./commands";

describe("parseCommandText", () => {
	it("accepts a bare string as a text command", () => {
		expect(parseCommandText("go")).toEqual({ type: "text", text: "go" });
	});

	it("accepts an object with a text field as a text command", () => {
		expect(parseCommandText({ text: "go" })).toEqual({
			type: "text",
			text: "go",
		});
	});

	it("accepts an approval command", () => {
		expect(
			parseCommandText({
				type: "approval",
				requestId: "req_1",
				optionId: "allow",
			})
		).toEqual({ type: "approval", requestId: "req_1", optionId: "allow" });
	});

	it("rejects an approval object missing requestId/optionId", () => {
		expect(
			parseCommandText({ type: "approval", requestId: "req_1" })
		).toBeNull();
	});

	it("accepts a control:stop command", () => {
		expect(parseCommandText({ type: "control", action: "stop" })).toEqual({
			type: "control",
			action: "stop",
		});
	});

	it("rejects a control command with an unrecognized action", () => {
		expect(parseCommandText({ type: "control", action: "pause" })).toBeNull();
	});

	it("rejects anything else", () => {
		expect(parseCommandText(42)).toBeNull();
		expect(parseCommandText(null)).toBeNull();
		expect(parseCommandText({ other: "go" })).toBeNull();
	});
});

// The Local Agent detail page's session controls (Phase 5).
describe("parseCommandText control commands", () => {
	it("accepts a control:interrupt command", () => {
		expect(parseCommandText({ type: "control", action: "interrupt" })).toEqual({
			type: "control",
			action: "interrupt",
		});
	});

	it("accepts a control:setModel command", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "setModel",
				model: "opus",
			})
		).toEqual({ type: "control", action: "setModel", model: "opus" });
	});

	it("rejects a control:setModel command missing its model", () => {
		expect(
			parseCommandText({ type: "control", action: "setModel" })
		).toBeNull();
	});

	it("accepts a control:setPermissionMode command", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "setPermissionMode",
				mode: "plan",
			})
		).toEqual({ type: "control", action: "setPermissionMode", mode: "plan" });
	});

	it("rejects a control:setPermissionMode command missing its mode", () => {
		expect(
			parseCommandText({ type: "control", action: "setPermissionMode" })
		).toBeNull();
	});

	it("accepts a control:listSessions command", () => {
		expect(
			parseCommandText({ type: "control", action: "listSessions" })
		).toEqual({ type: "control", action: "listSessions" });
	});

	it("accepts a control:restart command", () => {
		expect(parseCommandText({ type: "control", action: "restart" })).toEqual({
			type: "control",
			action: "restart",
		});
	});
});

// Cross-boundary regression: apps/web/src/components/bridge/
// use-bridge-terminal.ts's `makeAnswerApproval` sends its decision as an
// object, never `JSON.stringify`'d — the string check in `parseCommandText`
// runs first, so a stringified approval would otherwise be indistinguishable
// from plain chat text and never reach `answerApproval`.
describe("parseCommandText web/CLI approval boundary", () => {
	it("routes the exact object the web sends to an approval command, not text", () => {
		const webApprovalPayload = {
			type: "approval",
			requestId: "req-1",
			optionId: "allow",
		};

		expect(parseCommandText(webApprovalPayload)).toEqual({
			type: "approval",
			requestId: "req-1",
			optionId: "allow",
		});
	});

	it("treats a JSON.stringify'd approval payload as plain text, not a command", () => {
		const stringifiedApprovalPayload = JSON.stringify({
			type: "approval",
			requestId: "req-1",
			optionId: "allow",
		});

		expect(parseCommandText(stringifiedApprovalPayload)).toEqual({
			type: "text",
			text: stringifiedApprovalPayload,
		});
	});
});

/** Shared by both `dispatchCommands` describe blocks below (split apart for
 * the max-lines-per-function gate) so each exercises the same sink shape. */
function fakeSink(): CommandSink & {
	interrupt: Mock<() => void>;
	listSessions: Mock<() => void>;
	setModel: Mock<(model: string) => void>;
	setPermissionMode: Mock<(mode: string) => void>;
	stop: Mock<() => void>;
} {
	return {
		answerApproval: vi.fn(),
		interrupt: vi.fn(),
		listSessions: vi.fn(),
		send: vi.fn(),
		setModel: vi.fn(),
		setPermissionMode: vi.fn(),
		stop: vi.fn(),
	};
}

describe("dispatchCommands", () => {
	it("calls sink.stop and reports stopRequested for a control:stop command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands(
			[{ id: 7, data: { type: "control", action: "stop" } }],
			sink,
			afterIdRef
		);

		expect(sink.stop).toHaveBeenCalledTimes(1);
		expect(sink.send).not.toHaveBeenCalled();
		expect(result).toEqual({
			wasActive: true,
			stopRequested: true,
			restartRequested: false,
		});
		expect(afterIdRef.current).toBe(7);
	});

	it("never sets stopRequested for ordinary text/approval commands", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands([{ id: 1, data: "go" }], sink, afterIdRef);

		expect(result).toEqual({
			wasActive: true,
			stopRequested: false,
			restartRequested: false,
		});
	});

	it("reports stopRequested: false and wasActive: false when no commands are seen", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		expect(dispatchCommands([], sink, afterIdRef)).toEqual({
			wasActive: false,
			stopRequested: false,
			restartRequested: false,
		});
	});
});

// `restart`/`interrupt`, split out to stay under the max-lines gate.
describe("dispatchCommands restart/interrupt", () => {
	it("reports restartRequested (without calling any sink method) for a control:restart command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands(
			[{ id: 3, data: { type: "control", action: "restart" } }],
			sink,
			afterIdRef
		);

		expect(result).toEqual({
			wasActive: true,
			stopRequested: false,
			restartRequested: true,
		});
		expect(sink.stop).not.toHaveBeenCalled();
		expect(afterIdRef.current).toBe(3);
	});

	it("calls sink.interrupt (without setting stopRequested) for a control:interrupt command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands(
			[{ id: 1, data: { type: "control", action: "interrupt" } }],
			sink,
			afterIdRef
		);

		expect(sink.interrupt).toHaveBeenCalledTimes(1);
		expect(sink.stop).not.toHaveBeenCalled();
		expect(result).toEqual({
			wasActive: true,
			stopRequested: false,
			restartRequested: false,
		});
	});
});

// The Local Agent detail page's remaining session controls (Phase 5) routed
// through dispatchCommands, split out to stay under the same gate.
describe("dispatchCommands control commands", () => {
	it("calls sink.setModel with the requested model for a control:setModel command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		dispatchCommands(
			[{ id: 1, data: { type: "control", action: "setModel", model: "opus" } }],
			sink,
			afterIdRef
		);

		expect(sink.setModel).toHaveBeenCalledExactlyOnceWith("opus");
	});

	it("calls sink.setPermissionMode with the requested mode for a control:setPermissionMode command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		dispatchCommands(
			[
				{
					id: 1,
					data: { type: "control", action: "setPermissionMode", mode: "plan" },
				},
			],
			sink,
			afterIdRef
		);

		expect(sink.setPermissionMode).toHaveBeenCalledExactlyOnceWith("plan");
	});

	it("calls sink.listSessions for a control:listSessions command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands(
			[{ id: 1, data: { type: "control", action: "listSessions" } }],
			sink,
			afterIdRef
		);

		expect(sink.listSessions).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			wasActive: true,
			stopRequested: false,
			restartRequested: false,
		});
	});
});
