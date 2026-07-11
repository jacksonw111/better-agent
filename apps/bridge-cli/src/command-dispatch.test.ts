// R2-T3 item 2: `control: setThinking` parsing + dispatch — split into its
// own file rather than growing commands.test.ts (already at the repo's
// 300-line convention cap), mirroring command-dispatch.ts's split out of
// commands.ts for the same reason.

import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { dispatchTextCommand } from "./command-dispatch";
import type { CommandSink } from "./commands";
import { dispatchCommands, parseCommandText } from "./commands";

describe("parseCommandText control:setThinking", () => {
	it("accepts a control:setThinking command", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "setThinking",
				level: "high",
			})
		).toEqual({ type: "control", action: "setThinking", level: "high" });
	});

	it("rejects a control:setThinking command missing its level", () => {
		expect(
			parseCommandText({ type: "control", action: "setThinking" })
		).toBeNull();
	});
});

describe("dispatchCommands control:setThinking", () => {
	it("calls sink.setThinking with the requested level", () => {
		const sink: CommandSink & { setThinking: Mock<(level: string) => void> } = {
			answerApproval: vi.fn(),
			send: vi.fn(),
			setThinking: vi.fn(),
		};
		const afterIdRef = { current: 0 };

		const result = dispatchCommands(
			[
				{
					id: 1,
					data: { type: "control", action: "setThinking", level: "high" },
				},
			],
			sink,
			afterIdRef
		);

		expect(sink.setThinking).toHaveBeenCalledExactlyOnceWith("high");
		expect(result).toEqual({
			wasActive: true,
			stopRequested: false,
			restartRequested: false,
		});
	});

	it("is a no-op (no throw) when the sink doesn't implement setThinking", () => {
		const sink: CommandSink = { answerApproval: vi.fn(), send: vi.fn() };
		const afterIdRef = { current: 0 };

		expect(() =>
			dispatchCommands(
				[
					{
						id: 1,
						data: { type: "control", action: "setThinking", level: "high" },
					},
				],
				sink,
				afterIdRef
			)
		).not.toThrow();
	});
});

/** R3-T1: `dispatchTextCommand`'s `sendWith`-vs-`send` routing. */
function sendWithSink(): CommandSink & {
	send: Mock<(text: string) => void>;
	sendWith: Mock<(text: string, when: string) => void>;
} {
	return { answerApproval: vi.fn(), send: vi.fn(), sendWith: vi.fn() };
}

describe("dispatchTextCommand", () => {
	it("prefers sendWith for 'steer' when the sink implements it", () => {
		const sink = sendWithSink();
		dispatchTextCommand(sink, "redirect", "steer");
		expect(sink.sendWith).toHaveBeenCalledExactlyOnceWith("redirect", "steer");
		expect(sink.send).not.toHaveBeenCalled();
	});

	it("prefers sendWith for 'interrupt' when the sink implements it", () => {
		const sink = sendWithSink();
		dispatchTextCommand(sink, "fresh", "interrupt");
		expect(sink.sendWith).toHaveBeenCalledExactlyOnceWith("fresh", "interrupt");
		expect(sink.send).not.toHaveBeenCalled();
	});

	it("uses plain send (never sendWith) for 'queue', even when sendWith exists", () => {
		const sink = sendWithSink();
		dispatchTextCommand(sink, "go", "queue");
		expect(sink.send).toHaveBeenCalledExactlyOnceWith("go");
		expect(sink.sendWith).not.toHaveBeenCalled();
	});

	it("uses plain send (never sendWith) when `when` is absent, even when sendWith exists", () => {
		const sink = sendWithSink();
		dispatchTextCommand(sink, "go", undefined);
		expect(sink.send).toHaveBeenCalledExactlyOnceWith("go");
		expect(sink.sendWith).not.toHaveBeenCalled();
	});

	it("falls back to send for 'interrupt' when the sink has no sendWith (no throw)", () => {
		const sink: CommandSink = { answerApproval: vi.fn(), send: vi.fn() };
		dispatchTextCommand(sink, "fresh", "interrupt");
		expect(sink.send).toHaveBeenCalledExactlyOnceWith("fresh");
	});

	it("dispatchCommands routes a relayed { when: 'steer' } text command through sendWith", () => {
		const sink = sendWithSink();
		const afterIdRef = { current: 0 };

		dispatchCommands(
			[{ id: 1, data: { type: "text", text: "redirect", when: "steer" } }],
			sink,
			afterIdRef
		);

		expect(sink.sendWith).toHaveBeenCalledExactlyOnceWith("redirect", "steer");
		expect(sink.send).not.toHaveBeenCalled();
	});
});
