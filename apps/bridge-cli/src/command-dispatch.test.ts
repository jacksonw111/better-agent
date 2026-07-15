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

/** R3-T1: `dispatchTextCommand`'s `sendWith`-vs-`send` routing. P3-T2: both
 * mocks carry the optional trailing image-ref param. */
function sendWithSink(): CommandSink & {
	send: Mock<CommandSink["send"]>;
	sendWith: Mock<NonNullable<CommandSink["sendWith"]>>;
} {
	return { answerApproval: vi.fn(), send: vi.fn(), sendWith: vi.fn() };
}

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

// P3-T2: image refs ride the dispatch — passed ONLY when present, so the
// image-less calls above stay arity-identical to the pre-P3-T2 wire.
const IMAGE_REF = { id: "att-1", mime: "image/png", name: "shot.png" };

it("passes image refs through plain send", () => {
	const sink = sendWithSink();
	dispatchTextCommand(sink, "look", undefined, [IMAGE_REF]);
	expect(sink.send).toHaveBeenCalledExactlyOnceWith("look", [IMAGE_REF]);
});

it("passes image refs through sendWith for 'interrupt'", () => {
	const sink = sendWithSink();
	dispatchTextCommand(sink, "look", "interrupt", [IMAGE_REF]);
	expect(sink.sendWith).toHaveBeenCalledExactlyOnceWith("look", "interrupt", [
		IMAGE_REF,
	]);
	expect(sink.send).not.toHaveBeenCalled();
});

it("dispatchCommands routes a relayed { text, images } command's refs into send", () => {
	const sink = sendWithSink();
	dispatchCommands(
		[{ id: 1, data: { type: "text", text: "look", images: [IMAGE_REF] } }],
		sink,
		{ current: 0 }
	);
	expect(sink.send).toHaveBeenCalledExactlyOnceWith("look", [IMAGE_REF]);
});
