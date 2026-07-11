import { describe, expect, it } from "vitest";
import { normalizePiExtensionUiRequest } from "./pi-extension-ui";

describe("normalizePiExtensionUiRequest (RC-T4) - select/confirm map to a card", () => {
	it("maps a select request to an ApprovalEvent whose option ids are the option labels", () => {
		const events = normalizePiExtensionUiRequest({
			type: "extension_ui_request",
			id: "req-1",
			method: "select",
			title: "Allow dangerous command?",
			options: ["Allow", "Block"],
		});
		expect(events).toEqual([
			{
				detail: undefined,
				kind: "approval",
				options: [
					{ id: "Allow", label: "Allow" },
					{ id: "Block", label: "Block" },
				],
				requestId: "req-1",
				title: "Allow dangerous command?",
			},
		]);
	});

	it("maps a confirm request to an ApprovalEvent with fixed confirmed/declined options", () => {
		const events = normalizePiExtensionUiRequest({
			type: "extension_ui_request",
			id: "req-2",
			method: "confirm",
			title: "Clear session?",
			message: "All messages will be lost.",
		});
		expect(events).toEqual([
			{
				detail: "All messages will be lost.",
				kind: "approval",
				options: [
					{ id: "confirmed", label: "Confirm" },
					{ id: "declined", label: "Decline" },
				],
				requestId: "req-2",
				title: "Clear session?",
			},
		]);
	});
});

describe("normalizePiExtensionUiRequest (RC-T4) - non-representable/malformed input", () => {
	it("returns [] for input/editor methods — free-form text has no deny analog", () => {
		expect(
			normalizePiExtensionUiRequest({
				type: "extension_ui_request",
				id: "req-3",
				method: "input",
				title: "Enter a value",
			})
		).toEqual([]);
		expect(
			normalizePiExtensionUiRequest({
				type: "extension_ui_request",
				id: "req-4",
				method: "editor",
				title: "Edit some text",
			})
		).toEqual([]);
	});

	it("returns [] for a malformed select with no usable string options", () => {
		expect(
			normalizePiExtensionUiRequest({
				type: "extension_ui_request",
				id: "req-5",
				method: "select",
				title: "Pick one",
				options: [],
			})
		).toEqual([]);
	});

	it("returns [] for a non-extension_ui_request line", () => {
		expect(normalizePiExtensionUiRequest({ type: "agent_start" })).toEqual([]);
	});
});
