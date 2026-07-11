// Split out of pi-commands.test.ts, mirroring pi-models.ts's split out of
// pi-commands.ts (both purely to keep their files under the repo's 300-line
// limit).

import { describe, expect, it } from "vitest";
import {
	buildPiGetAvailableModelsCommand,
	normalizePiAvailableModels,
	normalizePiModelProviders,
} from "./pi-models";

describe("buildPiGetAvailableModelsCommand", () => {
	it("builds the get_available_models command frame", () => {
		expect(JSON.parse(buildPiGetAvailableModelsCommand())).toEqual({
			type: "get_available_models",
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
