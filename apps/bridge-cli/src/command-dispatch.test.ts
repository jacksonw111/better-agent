// R2-T3 item 2: `control: setThinking` parsing + dispatch — split into its
// own file rather than growing commands.test.ts (already at the repo's
// 300-line convention cap), mirroring command-dispatch.ts's split out of
// commands.ts for the same reason.

import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
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
