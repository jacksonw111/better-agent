import { expect, it } from "vitest";
import { latestCommandCatalogDetail } from "./bridge-command-catalog";
import type { StreamEvent } from "./bridge-events";

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("returns null when no command_catalog event has arrived", () => {
	expect(latestCommandCatalogDetail([])).toBeNull();
});

it("parses the latest command_catalog detail's commands", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "command_catalog",
			detail: {
				commands: [
					{ name: "compact", description: "Compact the conversation" },
					{ name: "cost", source: "extension" },
				],
			},
		}),
	];
	expect(latestCommandCatalogDetail(events)).toEqual({
		commands: [
			{ name: "compact", description: "Compact the conversation" },
			{ name: "cost", source: "extension" },
		],
	});
});

it("drops a command_catalog entry missing its name, keeping well-formed ones", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "command_catalog",
			detail: {
				commands: [{ description: "no name, dropped" }, { name: "usage" }],
			},
		}),
	];
	expect(latestCommandCatalogDetail(events)).toEqual({
		commands: [{ name: "usage", description: undefined, source: undefined }],
	});
});

it("returns null for a malformed detail", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "command_catalog",
			detail: "not-an-object",
		}),
	];
	expect(latestCommandCatalogDetail(events)).toBeNull();
});

it("treats a REPLACEMENT emission as the latest, superseding the earlier one", () => {
	const events: StreamEvent[] = [
		ev(1, {
			kind: "status",
			status: "command_catalog",
			detail: { commands: [{ name: "old-command" }] },
		}),
		ev(2, {
			kind: "status",
			status: "command_catalog",
			detail: { commands: [{ name: "new-command" }] },
		}),
	];
	expect(latestCommandCatalogDetail(events)).toEqual({
		commands: [{ name: "new-command" }],
	});
});
