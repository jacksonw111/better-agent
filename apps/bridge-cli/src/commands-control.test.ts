import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { CommandSink } from "./commands";
import { dispatchCommands, parseCommandText } from "./commands";

describe("cua control commands", () => {
	it("parses startVm and stopVm", () => {
		expect(parseCommandText({ type: "control", action: "startVm" })).toEqual({
			type: "control",
			action: "startVm",
		});
		expect(parseCommandText({ type: "control", action: "stopVm" })).toEqual({
			type: "control",
			action: "stopVm",
		});
	});

	it("dispatches to sink.startVm / sink.stopVm", () => {
		const sink: CommandSink & {
			startVm: Mock<() => void>;
			stopVm: Mock<() => void>;
		} = {
			answerApproval: vi.fn(),
			send: vi.fn(),
			startVm: vi.fn(),
			stopVm: vi.fn(),
		};
		const afterIdRef = { current: 0 };
		dispatchCommands(
			[{ id: 1, data: { type: "control", action: "startVm" } }],
			sink,
			afterIdRef
		);
		dispatchCommands(
			[{ id: 2, data: { type: "control", action: "stopVm" } }],
			sink,
			afterIdRef
		);
		expect(sink.startVm).toHaveBeenCalledTimes(1);
		expect(sink.stopVm).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when the sink omits startVm/stopVm", () => {
		const sink: CommandSink = { answerApproval: vi.fn(), send: vi.fn() };
		expect(() =>
			dispatchCommands(
				[{ id: 1, data: { type: "control", action: "startVm" } }],
				sink,
				{ current: 0 }
			)
		).not.toThrow();
	});
});
