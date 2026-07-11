import { describe, expect, it } from "vitest";
import {
	buildPiExtensionUiCancelResponse,
	buildPiExtensionUiResponse,
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	buildPiSetModelCommand,
	buildPiSetThinkingLevelCommand,
	isPiThinkingLevel,
	normalizePiCommandsResponse,
	normalizePiStateModel,
} from "./pi-commands";

// `get_available_models`' command builder + response parsers (re-exported
// from pi-models.ts, see that file's header) are tested in pi-models.test.ts,
// alongside that module's other tests — kept out of this file purely for the
// 300-line convention (mirrors the pi-commands.ts/pi-models.ts split).

describe("buildPiPromptCommand", () => {
	it("builds a bare prompt command frame with no streamingBehavior", () => {
		const frame = buildPiPromptCommand("continue please");
		expect(JSON.parse(frame)).toEqual({
			type: "prompt",
			message: "continue please",
		});
	});

	// CRITICAL (R2-T3 item 1): pi ERRORS on a bare prompt sent while it's still
	// streaming a turn — `streamingBehavior` must ride along whenever the
	// caller (the adapter's streaming tracker) says so.
	it("carries streamingBehavior when one is passed", () => {
		expect(JSON.parse(buildPiPromptCommand("steer now", "steer"))).toEqual({
			type: "prompt",
			message: "steer now",
			streamingBehavior: "steer",
		});
		expect(JSON.parse(buildPiPromptCommand("queue this", "followUp"))).toEqual({
			type: "prompt",
			message: "queue this",
			streamingBehavior: "followUp",
		});
	});
});

describe("isPiThinkingLevel / buildPiSetThinkingLevelCommand", () => {
	it("accepts every documented level and rejects anything else", () => {
		for (const level of [
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]) {
			expect(isPiThinkingLevel(level)).toBe(true);
		}
		expect(isPiThinkingLevel("ultra")).toBe(false);
		expect(isPiThinkingLevel("")).toBe(false);
	});

	it("builds the set_thinking_level command frame", () => {
		expect(JSON.parse(buildPiSetThinkingLevelCommand("high"))).toEqual({
			type: "set_thinking_level",
			level: "high",
		});
	});
});

describe("buildPiGetCommandsCommand / buildPiGetStateCommand", () => {
	it("builds the get_commands and get_state command frames", () => {
		expect(JSON.parse(buildPiGetCommandsCommand())).toEqual({
			type: "get_commands",
		});
		expect(JSON.parse(buildPiGetStateCommand())).toEqual({ type: "get_state" });
	});
});

describe("buildPiSetModelCommand", () => {
	it("builds the set_model command frame", () => {
		expect(JSON.parse(buildPiSetModelCommand("openai", "gpt-5"))).toEqual({
			type: "set_model",
			provider: "openai",
			modelId: "gpt-5",
		});
	});
});

describe("normalizePiCommandsResponse", () => {
	it("splits get_commands' flat list into slashCommands and skills", () => {
		const result = normalizePiCommandsResponse({
			type: "response",
			command: "get_commands",
			success: true,
			data: {
				commands: [
					{ name: "session-name", source: "extension" },
					{ name: "fix-tests", source: "prompt" },
					{ name: "skill:brave-search", source: "skill" },
				],
			},
		});
		expect(result).toEqual({
			slashCommands: ["session-name", "fix-tests", "skill:brave-search"],
			skills: ["brave-search"],
		});
	});

	it("returns null for a response to a different command", () => {
		expect(
			normalizePiCommandsResponse({
				type: "response",
				command: "get_state",
				success: true,
				data: {},
			})
		).toBeNull();
	});

	it("returns null for a failed get_commands response, or non-response input", () => {
		expect(
			normalizePiCommandsResponse({
				type: "response",
				command: "get_commands",
				success: false,
				error: "boom",
			})
		).toBeNull();
		expect(normalizePiCommandsResponse({ type: "agent_start" })).toBeNull();
		expect(normalizePiCommandsResponse(null)).toBeNull();
	});
});

// R2-T3 item 4: pi v0.80.6 moved a command's provenance from a flat `source`
// string into `sourceInfo: { scope, ... }` — split into its own describe
// purely to keep `normalizePiCommandsResponse`'s describe under the repo's
// max-lines-per-function gate.
describe("normalizePiCommandsResponse dual-format (R2-T3 item 4)", () => {
	it("also splits skills correctly from v0.80.6's sourceInfo.scope shape", () => {
		const result = normalizePiCommandsResponse({
			type: "response",
			command: "get_commands",
			success: true,
			data: {
				commands: [
					{ name: "session-name", sourceInfo: { scope: "extension" } },
					{ name: "skill:brave-search", sourceInfo: { scope: "skill" } },
				],
			},
		});
		expect(result).toEqual({
			slashCommands: ["session-name", "skill:brave-search"],
			skills: ["brave-search"],
		});
	});
});

describe("normalizePiStateModel", () => {
	it("extracts the model id from a get_state response", () => {
		const model = normalizePiStateModel({
			type: "response",
			command: "get_state",
			success: true,
			data: {
				model: { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
			},
		});
		expect(model).toBe("claude-sonnet-4-20250514");
	});

	it("falls back to the model name when there's no id", () => {
		const model = normalizePiStateModel({
			type: "response",
			command: "get_state",
			success: true,
			data: { model: { name: "Claude Sonnet 4" } },
		});
		expect(model).toBe("Claude Sonnet 4");
	});

	it("is undefined when data.model is null, or the response is for a different command", () => {
		expect(
			normalizePiStateModel({
				type: "response",
				command: "get_state",
				success: true,
				data: { model: null },
			})
		).toBeUndefined();
		expect(
			normalizePiStateModel({
				type: "response",
				command: "get_commands",
				success: true,
				data: { commands: [] },
			})
		).toBeUndefined();
	});
});

describe("buildPiExtensionUiResponse (RC-T4)", () => {
	it("replies a confirm method with a confirmed boolean, true only for the confirmed option id", () => {
		expect(
			JSON.parse(buildPiExtensionUiResponse("confirm", "req-1", "confirmed"))
		).toEqual({ type: "extension_ui_response", id: "req-1", confirmed: true });
		expect(
			JSON.parse(buildPiExtensionUiResponse("confirm", "req-1", "declined"))
		).toEqual({ type: "extension_ui_response", id: "req-1", confirmed: false });
	});

	it("replies a select method with the picked option id as value", () => {
		expect(
			JSON.parse(buildPiExtensionUiResponse("select", "req-2", "Allow"))
		).toEqual({ type: "extension_ui_response", id: "req-2", value: "Allow" });
	});
});

describe("buildPiExtensionUiCancelResponse (RC-T4)", () => {
	it("builds the fail-closed cancel reply, regardless of method", () => {
		expect(JSON.parse(buildPiExtensionUiCancelResponse("req-3"))).toEqual({
			type: "extension_ui_response",
			id: "req-3",
			cancelled: true,
		});
	});
});
