// R5-T1: opencodeServeAdapter's command_catalog integration — split out of
// opencode-serve.test.ts purely to keep that file under the repo's 300-line
// cap (it's already at the limit).

import { afterEach, describe, expect, it, vi } from "vitest";
import { startServe } from "./opencode-serve-test-support";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("opencodeServeAdapter - command_catalog (R5-T1)", () => {
	it("emits command_catalog right after session_ready when GET /command has entries", async () => {
		const { handle } = await startServe((server) => {
			server.commands.commandsBody = [
				{ name: "help", description: "Show help" },
				{ name: "clear" },
			];
		});
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		const { value: catalogEvent } = await iterator.next();
		expect(catalogEvent).toMatchObject({
			kind: "status",
			status: "command_catalog",
			detail: {
				commands: [
					{ name: "help", description: "Show help" },
					{ name: "clear", description: undefined },
				],
			},
		});
	});

	it("emits no command_catalog when GET /command returns nothing (old server)", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		const commandsCall = server.calls.find((call) =>
			call.url.endsWith("/command")
		);
		expect(commandsCall).toBeDefined();

		// Nothing else was ever pushed as command_catalog — the adapter's
		// pushServeCommandCatalog skips entirely on an empty catalog.
		server.emitSse({
			type: "message.part.updated",
			properties: {
				part: { id: "prt_1", sessionID: "ses_1", type: "text", text: "hi" },
			},
		});
		const { value: nextEvent } = await iterator.next();
		expect(nextEvent).toMatchObject({ kind: "output" });
	});
});
