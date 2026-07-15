import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import {
	CHUNK_CONTENT_BYTES,
	chunkContent,
	createFsReader,
	withFsReader,
} from "./fs-reader";
import type { StatusEvent } from "./normalize/types";

// P4-T3: the read-only fs channel — list shape/order, read chunking, binary
// detection, and error replies that still carry the caller's requestId.

const ESCAPES_RE = /escapes/;
const DIRECTORY_RE = /directory/;

let root = "";

beforeAll(async () => {
	root = await mkdtemp(path.join(tmpdir(), "fs-reader-"));
	await mkdir(path.join(root, "sub"));
	await writeFile(path.join(root, "b.txt"), "beta");
	await writeFile(path.join(root, "a.txt"), "alpha");
	await writeFile(path.join(root, "big.txt"), "x".repeat(30_000));
	await writeFile(
		path.join(root, "bin.dat"),
		Buffer.from([1, 2, 0, 3, 4, 0, 5])
	);
});

interface Detail {
	binary?: boolean;
	chunkIndex?: number;
	content?: string;
	done?: boolean;
	entries?: { name: string; size?: number; type: string }[];
	error?: string;
	path?: string;
	requestId?: string;
	totalChunks?: number;
	truncated?: boolean;
}

function collect(): {
	details: Detail[];
	reader: ReturnType<typeof createFsReader>;
} {
	const details: Detail[] = [];
	const reader = createFsReader({
		dir: root,
		pushEvent: (event) => details.push((event as StatusEvent).detail as Detail),
	});
	return { details, reader };
}

async function settled(details: Detail[], count = 1): Promise<void> {
	await vi.waitFor(() => expect(details.length).toBeGreaterThanOrEqual(count));
}

// Non-optional first reply, throwing (test failure) when absent, so field
// reads stay legal under noUncheckedIndexedAccess.
function first(details: Detail[]): Detail {
	const detail = details[0];
	if (!detail) {
		throw new Error("no reply pushed");
	}
	return detail;
}

it("lists the root dirs-first then alpha, sizes on files only", async () => {
	const { details, reader } = collect();
	reader.list("req-1");
	await settled(details);
	const detail = first(details);
	expect(detail.requestId).toBe("req-1");
	expect(detail.truncated).toBe(false);
	expect(detail.entries?.map((entry) => entry.name)).toEqual([
		"sub",
		"a.txt",
		"b.txt",
		"big.txt",
		"bin.dat",
	]);
	expect(detail.entries?.[0]?.type).toBe("dir");
	expect(detail.entries?.[0]?.size).toBeUndefined();
	expect(detail.entries?.[1]?.size).toBe(5);
});

it("replies with an error (same requestId) for an escaping list path", async () => {
	const { details, reader } = collect();
	reader.list("req-2", "../outside");
	await settled(details);
	expect(first(details).requestId).toBe("req-2");
	expect(first(details).error).toMatch(ESCAPES_RE);
	expect(first(details).entries).toBeUndefined();
});

it("reads a small file as a single done chunk", async () => {
	const { details, reader } = collect();
	reader.read("req-3", "a.txt");
	await settled(details);
	expect(details).toHaveLength(1);
	expect(first(details)).toMatchObject({
		chunkIndex: 0,
		content: "alpha",
		done: true,
		requestId: "req-3",
		totalChunks: 1,
		truncated: false,
	});
});

it("chunks a large file, done only on the last chunk", async () => {
	const { details, reader } = collect();
	reader.read("req-4", "big.txt");
	await settled(details, 3);
	expect(details).toHaveLength(3);
	expect(details.map((detail) => detail.chunkIndex)).toEqual([0, 1, 2]);
	expect(details.map((detail) => detail.done)).toEqual([false, false, true]);
	expect(details.every((detail) => detail.totalChunks === 3)).toBe(true);
	const joined = details.map((detail) => detail.content).join("");
	expect(joined).toBe("x".repeat(30_000));
});

it("marks a null-byte file binary with no content", async () => {
	const { details, reader } = collect();
	reader.read("req-5", "bin.dat");
	await settled(details);
	expect(first(details)).toMatchObject({
		binary: true,
		content: "",
		done: true,
		requestId: "req-5",
	});
});

it("replies with an error when reading a directory or escaping path", async () => {
	const { details, reader } = collect();
	reader.read("req-6", "sub");
	reader.read("req-7", "../etc/passwd");
	await settled(details, 2);
	const byId = new Map(details.map((detail) => [detail.requestId, detail]));
	expect(byId.get("req-6")?.error).toMatch(DIRECTORY_RE);
	expect(byId.get("req-7")?.error).toMatch(ESCAPES_RE);
});

it("keeps every chunk within the per-chunk byte budget for multi-byte text", () => {
	const text = "汉".repeat(10_000);
	const chunks = chunkContent(text);
	expect(chunks.length).toBeGreaterThan(1);
	for (const chunk of chunks) {
		expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(
			CHUNK_CONTENT_BYTES
		);
	}
	expect(chunks.join("")).toBe(text);
	expect(chunkContent("")).toEqual([""]);
});

it("withFsReader keeps inherited methods as own enumerable properties", () => {
	const handle = { send: vi.fn(), stop: vi.fn() };
	const wrapped = withFsReader(handle, {
		dir: root,
		pushEvent: () => undefined,
	});
	const spread = { ...wrapped };
	expect(typeof spread.send).toBe("function");
	expect(typeof spread.fsList).toBe("function");
	expect(typeof spread.fsRead).toBe("function");
});
