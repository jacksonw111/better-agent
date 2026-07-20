import { describe, expect, it } from "vitest";
import type { StatusEvent } from "./normalize/types";
import { MAX_EVENT_BYTES, truncateEvent } from "./truncate-event";
import { shrinkOversizedStatusEvent } from "./truncate-status-shrink";

// Repro (resume-caps investigation, 2026-07-19): on a plugin-heavy machine the
// claude-code adapter's one-time `command_catalog` event measured 51_827 bytes
// (162 slash commands with long descriptions) — over the server's 32_768-byte
// cap — so `truncateEvent` degraded it wholesale to `event_truncated`: the web
// lost the entire slash-command list and the session feed's FIRST persisted
// event was opaque garbage. These specs pin the structural alternative: shrink
// the payload (trim descriptions, then drop them, then drop tail commands)
// instead of throwing the whole catalog away — and give `session_ready` (the
// capability handshake every Git/Files/Shell gate hangs off) the same
// never-degrade guarantee by dropping its bulky list fields first.

const LONG_DESCRIPTION_CHARS = 400;
const CATALOG_COMMAND_COUNT = 162;
const PATHOLOGICAL_COMMAND_COUNT = 20_000;
const HUGE_LIST_ITEM_COUNT = 4000;
const OVERSIZE_FACTOR = 2;

function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function catalogEvent(count: number, descriptionChars: number): StatusEvent {
	return {
		detail: {
			commands: Array.from({ length: count }, (_, index) => ({
				description: "d".repeat(descriptionChars),
				name: `command-${index}`,
			})),
		},
		kind: "status",
		status: "command_catalog",
	};
}

interface CatalogDetail {
	commands: { description?: string; name: string }[];
}

describe("shrinkOversizedStatusEvent — command_catalog", () => {
	it("keeps every command name when trimming descriptions is enough", () => {
		// 162 × 400-char descriptions ≈ 70KB — the real-machine shape, scaled up.
		const event = catalogEvent(CATALOG_COMMAND_COUNT, LONG_DESCRIPTION_CHARS);
		expect(byteSizeOf(event)).toBeGreaterThan(MAX_EVENT_BYTES);

		const result = truncateEvent(event) as StatusEvent;

		expect(result.status).toBe("command_catalog");
		expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
		const { commands } = result.detail as CatalogDetail;
		expect(commands).toHaveLength(CATALOG_COMMAND_COUNT);
		expect(commands[0]?.name).toBe("command-0");
		expect(commands.at(-1)?.name).toBe(`command-${CATALOG_COMMAND_COUNT - 1}`);
		// Descriptions survive, just shorter.
		expect(commands[0]?.description?.length).toBeLessThan(
			LONG_DESCRIPTION_CHARS
		);
	});

	it("drops the tail of a pathologically long list rather than the whole catalog", () => {
		const event = catalogEvent(PATHOLOGICAL_COMMAND_COUNT, 0);

		const result = truncateEvent(event) as StatusEvent;

		expect(result.status).toBe("command_catalog");
		expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
		const { commands } = result.detail as CatalogDetail;
		expect(commands.length).toBeGreaterThan(0);
		expect(commands.length).toBeLessThan(PATHOLOGICAL_COMMAND_COUNT);
		// The HEAD of the list survives — never a random slice.
		expect(commands[0]?.name).toBe("command-0");
	});
});

describe("shrinkOversizedStatusEvent — session_ready", () => {
	it("sheds bulky list fields but never the capability handshake", () => {
		const event: StatusEvent = {
			detail: {
				capabilities: { fs: true, git: true, shell: true },
				model: "sonnet",
				models: ["sonnet", "opus"],
				permissionMode: "default",
				sessionId: "sess-1",
				skills: Array.from(
					{ length: HUGE_LIST_ITEM_COUNT },
					(_, i) => `skill-${i}`
				),
				slashCommands: Array.from(
					{ length: HUGE_LIST_ITEM_COUNT },
					(_, i) => `command-${i}`
				),
				tools: Array.from(
					{ length: HUGE_LIST_ITEM_COUNT },
					(_, i) => `tool-${i}`
				),
			},
			kind: "status",
			status: "session_ready",
		};
		expect(byteSizeOf(event)).toBeGreaterThan(MAX_EVENT_BYTES);

		const result = truncateEvent(event) as StatusEvent;

		expect(result.status).toBe("session_ready");
		expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
		expect(result.detail).toMatchObject({
			capabilities: { fs: true, git: true, shell: true },
			model: "sonnet",
			models: ["sonnet", "opus"],
			permissionMode: "default",
			sessionId: "sess-1",
		});
	});
});

describe("shrinkOversizedStatusEvent — everything else", () => {
	it("declines statuses it doesn't know, so truncateEvent still degrades them", () => {
		const event: StatusEvent = {
			detail: {
				blob: { nested: "x".repeat(OVERSIZE_FACTOR * MAX_EVENT_BYTES) },
			},
			kind: "status",
			status: "some_other_status",
		};

		expect(shrinkOversizedStatusEvent(event)).toBeUndefined();
		expect(truncateEvent(event)).toEqual({
			detail: { originalKind: "status" },
			kind: "status",
			status: "event_truncated",
		});
	});

	it("declines a session_ready whose detail isn't a record", () => {
		const event: StatusEvent = {
			detail: "x".repeat(OVERSIZE_FACTOR * MAX_EVENT_BYTES),
			kind: "status",
			status: "session_ready",
		};

		expect(shrinkOversizedStatusEvent(event)).toBeUndefined();
	});
});
