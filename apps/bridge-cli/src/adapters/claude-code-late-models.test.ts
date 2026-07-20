import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery, nextEvent } from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

// The startup handshake can only wait so long on the SDK's `supportedModels()`
// before it must ship (a stuck control channel must never freeze the feed's
// first event). Until now a list that arrived AFTER that window was simply
// dropped, and since the handshake is one-time the composer's model picker
// vanished for the entire session with no way back. It's now re-announced out
// of band as a `model_catalog` — a late list beats no list. Deliberately NOT a
// second `session_ready`: the web folds a handshake by replacing the base
// detail wholesale, which would wipe what the real init line contributes.

/** Comfortably past `SUPPORTED_MODELS_TIMEOUT_MS` (8s) in claude-code-models.ts. */
const PAST_MODELS_TIMEOUT_MS = 9000;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

/** Starts the adapter with `supportedModels()` left hanging, driving the clock
 * past the handshake's window so `start()` can resolve on the timeout —
 * `start()` awaits that race, so the clock must advance while it's in flight.
 * Returns the still-unresolved fetch's `release` plus the drained handshake. */
async function startWithHangingModels() {
	const { harness } = mockQuery();
	let release: (models: { value: string }[]) => void = () => undefined;
	harness.supportedModels.mockReturnValue(
		new Promise<{ value: string }[]>((resolve) => {
			release = resolve;
		})
	);
	const starting = claudeCodeAdapter.start("/tmp/project");
	await vi.advanceTimersByTimeAsync(PAST_MODELS_TIMEOUT_MS);
	const handle = await starting;
	const iterator = handle.events[Symbol.asyncIterator]();
	const ready = await nextEvent(iterator);
	return { iterator, ready, release };
}

/** Whether ANY event lands within a tick — a plain `Promise.race` against an
 * already-resolved sentinel would always win and assert nothing. */
async function settledNextEvent(
	iterator: AsyncIterator<NormalizedEvent>
): Promise<NormalizedEvent | undefined> {
	let seen: NormalizedEvent | undefined;
	nextEvent(iterator).then((event) => {
		seen = event;
	});
	await vi.advanceTimersByTimeAsync(0);
	return seen;
}

it("re-announces a model list that resolved after the handshake timed out", async () => {
	const { iterator, ready, release } = await startWithHangingModels();
	// The handshake ships on the timeout, listless — the pre-existing behavior.
	expect(ready).toMatchObject({ kind: "status", status: "session_ready" });
	expect(
		(ready as { detail: Record<string, unknown> }).detail.models
	).toBeUndefined();

	release([{ value: "opus" }, { value: "sonnet" }]);
	await vi.advanceTimersByTimeAsync(0);

	expect(await nextEvent(iterator)).toMatchObject({
		kind: "status",
		status: "model_catalog",
		detail: { models: ["opus", "sonnet"] },
	});
});

it("emits no catalog event when the late list came back empty", async () => {
	const { iterator, release } = await startWithHangingModels();

	release([]);

	expect(await settledNextEvent(iterator)).toBeUndefined();
});

it("emits no catalog event when the list made the handshake in time", async () => {
	// In-time lists are already carried by `session_ready.models`; a second
	// announcement would be pure noise on the feed.
	mockQuery([{ value: "opus" }]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	expect(await nextEvent(iterator)).toMatchObject({
		status: "session_ready",
		detail: { models: ["opus"] },
	});

	await vi.advanceTimersByTimeAsync(PAST_MODELS_TIMEOUT_MS);

	expect(await settledNextEvent(iterator)).toBeUndefined();
});
