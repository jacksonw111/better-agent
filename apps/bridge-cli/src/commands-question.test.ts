// R3-T3: answerQuestion command parsing + dispatch — split out of
// commands.test.ts purely to keep both files under the repo's 300-line file
// cap (commands.test.ts already sat at the cap).

import { describe, expect, it, vi } from "vitest";
import type { CommandSink } from "./commands";
import { dispatchCommands, parseCommandText } from "./commands";

describe("parseCommandText control:answerQuestion", () => {
	it("accepts a control:answerQuestion command with requestId + answers", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "answerQuestion",
				requestId: "q_1",
				answers: [["staging"]],
			})
		).toEqual({
			type: "control",
			action: "answerQuestion",
			requestId: "q_1",
			answers: [["staging"]],
		});
	});

	it("accepts an empty answers array (the reject path)", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "answerQuestion",
				requestId: "q_1",
				answers: [],
			})
		).toEqual({
			type: "control",
			action: "answerQuestion",
			requestId: "q_1",
			answers: [],
		});
	});

	it("rejects a control:answerQuestion command missing requestId", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "answerQuestion",
				answers: [["staging"]],
			})
		).toBeNull();
	});
});

// Split into its own `describe` purely to keep each callback under the
// repo's max-lines-per-function gate.
describe("parseCommandText control:answerQuestion - malformed answers", () => {
	it("rejects a control:answerQuestion command whose answers isn't a string[][]", () => {
		expect(
			parseCommandText({
				type: "control",
				action: "answerQuestion",
				requestId: "q_1",
				answers: "staging",
			})
		).toBeNull();
		expect(
			parseCommandText({
				type: "control",
				action: "answerQuestion",
				requestId: "q_1",
				answers: [1],
			})
		).toBeNull();
	});
});

describe("dispatchCommands control:answerQuestion", () => {
	it("calls sink.answerQuestion with the requestId + answers", () => {
		const sink: CommandSink = {
			answerApproval: vi.fn(),
			answerQuestion: vi.fn(),
			send: vi.fn(),
		};
		const afterIdRef = { current: 0 };

		dispatchCommands(
			[
				{
					id: 1,
					data: {
						type: "control",
						action: "answerQuestion",
						requestId: "q_1",
						answers: [["staging"]],
					},
				},
			],
			sink,
			afterIdRef
		);

		expect(sink.answerQuestion).toHaveBeenCalledExactlyOnceWith("q_1", [
			["staging"],
		]);
	});

	it("is a silent no-op when the sink doesn't implement answerQuestion", () => {
		const sink: CommandSink = { answerApproval: vi.fn(), send: vi.fn() };
		const afterIdRef = { current: 0 };

		expect(() =>
			dispatchCommands(
				[
					{
						id: 1,
						data: {
							type: "control",
							action: "answerQuestion",
							requestId: "q_1",
							answers: [],
						},
					},
				],
				sink,
				afterIdRef
			)
		).not.toThrow();
	});
});
