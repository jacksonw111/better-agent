import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnPty } from "./spawn-pty";

// ---- Unit tests: fake broker, assert the fd wiring contract -----------------

// A stand-in for the broker child: stdin/stdio[3] are Writables we spy on,
// stdout/stdio[4] are emitters the test drives, exit is emitted on the child.
class FakeChild extends EventEmitter {
	pid = 9001;
	stdin = { write: vi.fn() };
	stdout = Object.assign(new EventEmitter(), {
		pause: vi.fn(),
		resume: vi.fn(),
	});
	ctrlIn = { write: vi.fn() };
	ctrlOut = new EventEmitter();
	stdio = [this.stdin, this.stdout, null, this.ctrlIn, this.ctrlOut];
	kill = vi.fn(() => true);
}

function fakeSetup() {
	const child = new FakeChild();
	const spawnImpl = vi.fn(
		() => child
	) as unknown as typeof import("node:child_process").spawn;
	const handle = spawnPty("claude", ["--flag"], "/work", 80, 24, {
		brokerPath: "/fake/broker",
		spawnImpl,
	});
	return { child, handle, spawnImpl };
}

it("spawns the broker with rows/cols/command/args and the 5-slot stdio", () => {
	const { spawnImpl } = fakeSetup();
	const spy = spawnImpl as unknown as ReturnType<typeof vi.fn>;
	expect(spy).toHaveBeenCalledWith(
		"/fake/broker",
		["24", "80", "claude", "--flag"],
		expect.objectContaining({
			cwd: "/work",
			stdio: ["pipe", "pipe", "inherit", "pipe", "pipe"],
		})
	);
});

it("passes a cleaned env through to the broker when provided (P25-C)", () => {
	const child = new FakeChild();
	const spawnImpl = vi.fn(
		() => child
	) as unknown as typeof import("node:child_process").spawn;
	spawnPty("claude", ["--resume", "id"], "/work", 80, 24, {
		brokerPath: "/fake/broker",
		spawnImpl,
		env: { PATH: "/bin" },
	});
	const spy = spawnImpl as unknown as ReturnType<typeof vi.fn>;
	expect(spy).toHaveBeenCalledWith(
		"/fake/broker",
		["24", "80", "claude", "--resume", "id"],
		expect.objectContaining({ env: { PATH: "/bin" } })
	);
});

it("write() forwards bytes to the broker stdin (pty input)", () => {
	const { child, handle } = fakeSetup();
	handle.write("ls\n");
	expect(child.stdin.write).toHaveBeenCalledWith("ls\n");
});

it("onData() receives raw pty output from stdout", () => {
	const { child, handle } = fakeSetup();
	const chunks: Buffer[] = [];
	handle.onData((d) => chunks.push(d));
	child.stdout.emit("data", Buffer.from("hi"));
	expect(Buffer.concat(chunks).toString()).toBe("hi");
});

it("resize() writes a 4-byte {rows,cols} little-endian frame to ctrl-in fd3", () => {
	const { child, handle } = fakeSetup();
	handle.resize(120, 40); // cols=120, rows=40
	expect(child.ctrlIn.write).toHaveBeenCalledTimes(1);
	const frame = child.ctrlIn.write.mock.calls[0]?.[0] as Buffer;
	expect(frame.length).toBe(4);
	expect(frame.readUInt16LE(0)).toBe(40); // rows
	expect(frame.readUInt16LE(2)).toBe(120); // cols
});

it("onExit() prefers the fd4 exit byte over the child exit code", () => {
	const { child, handle } = fakeSetup();
	const exits: Array<{ code: number | null }> = [];
	handle.onExit((e) => exits.push(e));
	child.ctrlOut.emit("data", Buffer.from([7]));
	child.emit("exit", 0, null); // child reports 0, fd4 says 7 → 7 wins
	expect(exits).toHaveLength(1);
	expect(exits[0]?.code).toBe(7);
});

it("onExit() falls back to the child exit code when no fd4 byte arrived", () => {
	const { child, handle } = fakeSetup();
	const exits: Array<{ code: number | null; signal: string | null }> = [];
	handle.onExit((e) => exits.push(e));
	child.emit("exit", 3, null);
	expect(exits[0]?.code).toBe(3);
});

it("onExit() fires exactly once", () => {
	const { child, handle } = fakeSetup();
	const exits: unknown[] = [];
	handle.onExit((e) => exits.push(e));
	child.emit("exit", 0, null);
	child.emit("exit", 0, null);
	expect(exits).toHaveLength(1);
});

it("pause()/resume() gate the broker stdout stream (flow-control backpressure)", () => {
	const { child, handle } = fakeSetup();
	handle.pause();
	expect(child.stdout.pause).toHaveBeenCalledTimes(1);
	handle.resume();
	expect(child.stdout.resume).toHaveBeenCalledTimes(1);
});

it("kill() signals the broker (default SIGTERM)", () => {
	const { child, handle } = fakeSetup();
	handle.kill();
	expect(child.kill).toHaveBeenCalledWith("SIGTERM");
	handle.kill("SIGKILL");
	expect(child.kill).toHaveBeenCalledWith("SIGKILL");
});

// ---- Integration tests: a REAL broker compiled from native/pty-broker.c -----
// Skipped gracefully when a C compiler isn't available.

const brokerSrc = fileURLToPath(
	new URL("../../native/pty-broker.c", import.meta.url)
);
let realBroker: string | undefined;
let compileError: string | undefined;

beforeAll(() => {
	try {
		const dir = mkdtempSync(join(tmpdir(), "pty-broker-test-"));
		const out = join(dir, "pty-broker");
		execFileSync("cc", ["-O2", "-o", out, brokerSrc], { stdio: "pipe" });
		if (existsSync(out)) {
			realBroker = out;
		}
	} catch (error) {
		compileError = error instanceof Error ? error.message : String(error);
	}
});

afterAll(() => {
	// mkdtemp dir left for OS temp cleanup; nothing to tear down.
});

function waitForExit(handle: ReturnType<typeof spawnPty>) {
	return new Promise<{ code: number | null; signal: string | null }>(
		(resolve) => handle.onExit(resolve)
	);
}

describe("real broker", () => {
	it("streams pty output and propagates the exit code", async () => {
		if (!realBroker) {
			expect(compileError ?? "cc unavailable").toBeTruthy();
			return;
		}
		const handle = spawnPty(
			"sh",
			["-c", "printf DATACHECK; exit 7"],
			process.cwd(),
			80,
			24,
			{ brokerPath: realBroker }
		);
		let out = "";
		handle.onData((d) => {
			out += d.toString("utf8");
		});
		const exit = await waitForExit(handle);
		expect(out).toContain("DATACHECK");
		expect(exit.code).toBe(7);
	});

	it("resize() propagates a new winsize into the pty (SIGWINCH)", async () => {
		if (!realBroker) {
			expect(compileError ?? "cc unavailable").toBeTruthy();
			return;
		}
		const handle = spawnPty("bash", ["--norc", "-i"], process.cwd(), 80, 24, {
			brokerPath: realBroker,
		});
		let out = "";
		handle.onData((d) => {
			out += d.toString("utf8");
		});
		const done = waitForExit(handle);
		await new Promise((r) => setTimeout(r, 200));
		handle.resize(120, 40); // cols=120 rows=40
		await new Promise((r) => setTimeout(r, 200));
		handle.write("stty size\n");
		await new Promise((r) => setTimeout(r, 200));
		handle.write("exit\n");
		await done;
		expect(out).toContain("40 120");
	}, 10_000);
});
