import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// Server-side size caps for the local agent bridge (spec §3.1: truncate
// oversized lines + bound the window). See
// packages/api/src/routers/bridge-size-limits.ts for MAX_EVENT_BYTES (262_144)
// / MAX_INPUT_CHARS (100_000), and bridge.ts for MAX_PUSH_BATCH.

const OVER_BATCH_LIMIT = 51;
const BYTES_PER_KB = 1024;
// Over the raised 256 KiB event cap.
const OVERSIZED_EVENT_KB = 300;
// Over the raised 100_000-char input cap.
const OVERSIZED_INPUT_KB = 120;
const OVERSIZED_EVENT_BYTES = OVERSIZED_EVENT_KB * BYTES_PER_KB;
const OVERSIZED_INPUT_CHARS = OVERSIZED_INPUT_KB * BYTES_PER_KB;
// Just under the 100_000-char input cap — must be accepted.
const UNDER_CAP_INPUT_CHARS = 99_000;

async function startSession() {
	const { bridgeClientFor, userClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	return { cli, sessionId, alice: userClientFor(ALICE) };
}

it("pushEvents rejects a batch of 51 events with BAD_REQUEST", async () => {
	const { cli, sessionId } = await startSession();
	const events = Array.from({ length: OVER_BATCH_LIMIT }, (_, i) => ({ i }));

	await expect(
		cli.bridge.pushEvents({ sessionId, events })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("pushEvents accepts a batch at the cap (50 events)", async () => {
	const { cli, sessionId } = await startSession();
	const events = Array.from({ length: OVER_BATCH_LIMIT - 1 }, (_, i) => ({
		i,
	}));

	await expect(cli.bridge.pushEvents({ sessionId, events })).resolves.toEqual({
		ok: true,
	});
});

it("pushEvents rejects a single event over the byte size cap with BAD_REQUEST", async () => {
	const { cli, sessionId } = await startSession();
	const oversizedEvent = { chunk: "x".repeat(OVERSIZED_EVENT_BYTES) };

	await expect(
		cli.bridge.pushEvents({ sessionId, events: [oversizedEvent] })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("sendInput rejects a data string over the char cap with BAD_REQUEST", async () => {
	const { sessionId, alice } = await startSession();
	const oversizedInput = "x".repeat(OVERSIZED_INPUT_CHARS);

	await expect(
		alice.bridge.sendInput({ sessionId, data: oversizedInput })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("sendInput accepts a long data string under the raised char cap", async () => {
	const { sessionId, alice } = await startSession();
	const longInput = "x".repeat(UNDER_CAP_INPUT_CHARS);

	await expect(
		alice.bridge.sendInput({ sessionId, data: longInput })
	).resolves.toEqual({ ok: true });
});
