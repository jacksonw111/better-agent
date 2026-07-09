import { describe, expect, it } from "vitest";
import {
	buildPiExtensionUiCancelResponse,
	buildPiExtensionUiResponse,
	buildPiGetAvailableModelsCommand,
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	buildPiSetModelCommand,
	normalizePiAvailableModels,
	normalizePiCommandsResponse,
	normalizePiModelProviders,
	normalizePiStateModel,
} from "./pi-commands";

describe("buildPiPromptCommand", () => {
	it("builds a prompt command frame", () => {
		const frame = buildPiPromptCommand("continue please");
		expect(JSON.parse(frame)).toEqual({
			type: "prompt",
			message: "continue please",
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

describe("buildPiGetAvailableModelsCommand / buildPiSetModelCommand", () => {
	it("builds the get_available_models and set_model command frames", () => {
		expect(JSON.parse(buildPiGetAvailableModelsCommand())).toEqual({
			type: "get_available_models",
		});
		expect(JSON.parse(buildPiSetModelCommand("openai", "gpt-5"))).toEqual({
			type: "set_model",
			provider: "openai",
			modelId: "gpt-5",
		});
	});
});

describe("normalizePiModelProviders", () => {
	it("maps model ids to their provider from get_available_models", () => {
		const raw = {
			type: "response",
			command: "get_available_models",
			success: true,
			data: {
				models: [
					{ id: "claude-sonnet-4", provider: "anthropic" },
					{ id: "gpt-5", provider: "openai" },
					{ id: "no-provider" },
				],
			},
		};
		expect(normalizePiModelProviders(raw)).toEqual({
			"claude-sonnet-4": "anthropic",
			"gpt-5": "openai",
		});
	});

	it("returns undefined for a non-get_available_models frame", () => {
		expect(
			normalizePiModelProviders({ type: "response", command: "get_state" })
		).toBeUndefined();
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

describe("normalizePiAvailableModels", () => {
	it("parses a successful get_available_models response into model ids", () => {
		const models = normalizePiAvailableModels({
			type: "response",
			command: "get_available_models",
			success: true,
			data: {
				models: [
					{ id: "claude-sonnet-4-20250514", name: "Sonnet" },
					{ name: "Unnamed Model" },
				],
			},
		});
		expect(models).toEqual(["claude-sonnet-4-20250514", "Unnamed Model"]);
	});

	it("is undefined for a different command, a failure, or a non-array", () => {
		expect(
			normalizePiAvailableModels({
				type: "response",
				command: "get_state",
				success: true,
				data: { model: { id: "x" } },
			})
		).toBeUndefined();
		expect(
			normalizePiAvailableModels({
				type: "response",
				command: "get_available_models",
				success: false,
				data: {},
			})
		).toBeUndefined();
		expect(
			normalizePiAvailableModels({
				type: "agent_start",
			})
		).toBeUndefined();
		expect(normalizePiAvailableModels(null)).toBeUndefined();
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
