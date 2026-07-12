import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_CUA_VM_NAME,
	type ExecResult,
	ensureCuaEnvironment,
	type LumeBootstrapDeps,
} from "./lume-bootstrap";
import type { LumeClient, LumeVm } from "./lume-client";

const OK: ExecResult = { code: 0, stdout: "", stderr: "" };
const FAIL: ExecResult = { code: 1, stdout: "", stderr: "boom" };

function fakeLume(overrides: Partial<LumeClient> = {}): LumeClient {
	return {
		list: () => Promise.resolve([]),
		get: () => Promise.resolve(null),
		run: () => Promise.resolve(),
		stop: () => Promise.resolve(),
		create: () => Promise.resolve(),
		...overrides,
	};
}

function deps(over: Partial<LumeBootstrapDeps> = {}): LumeBootstrapDeps {
	return {
		platform: "darwin",
		arch: "arm64",
		exec: vi.fn(() => Promise.resolve(OK)),
		spawnDetached: vi.fn(),
		lume: fakeLume(),
		log: vi.fn(),
		sleep: () => Promise.resolve(),
		...over,
	};
}

describe("ensureCuaEnvironment", () => {
	it("rejects a non-macOS/arm64 host with a clear error", async () => {
		await expect(
			ensureCuaEnvironment(deps({ platform: "linux", arch: "x64" }))
		).rejects.toThrow("Apple Silicon");
	});

	it("installs lume when the version check fails, then proceeds", async () => {
		const exec = vi.fn((cmd: string) =>
			Promise.resolve(cmd === "lume" ? FAIL : OK)
		);
		// First `lume --version` fails → install path; `/bin/sh` install returns OK.
		const install = vi.fn((cmd: string, args: string[]) =>
			cmd === "/bin/sh"
				? Promise.resolve(OK)
				: Promise.resolve(args.includes("--version") ? FAIL : OK)
		);
		const d = deps({ exec: install });
		await ensureCuaEnvironment(d);
		expect(install).toHaveBeenCalledWith("/bin/sh", [
			"-c",
			expect.stringContaining("install.sh"),
		]);
		expect(exec).not.toHaveBeenCalled();
	});

	it("starts lume serve when the API is unreachable, then polls until up", async () => {
		let up = false;
		const lume = fakeLume({
			list: () =>
				up
					? Promise.resolve([] as LumeVm[])
					: Promise.reject(new Error("down")),
		});
		const spawnDetached = vi.fn(() => {
			up = true;
		});
		const d = deps({ lume, spawnDetached });
		await ensureCuaEnvironment(d);
		expect(spawnDetached).toHaveBeenCalledWith("lume", ["serve"]);
	});
});

describe("ensureCuaEnvironment (vm image)", () => {
	it("pulls the image only when the named VM is absent", async () => {
		const exec = vi.fn(() => Promise.resolve(OK));
		const present = fakeLume({
			list: () =>
				Promise.resolve([
					{
						name: DEFAULT_CUA_VM_NAME,
						status: "stopped",
						vncUrl: null,
						ipAddress: null,
					},
				]),
		});
		await ensureCuaEnvironment(deps({ exec, lume: present }));
		expect(exec).not.toHaveBeenCalledWith(
			"lume",
			expect.arrayContaining(["pull"])
		);
	});

	it("returns the resolved vm name/image", async () => {
		const result = await ensureCuaEnvironment(deps());
		expect(result.vmName).toBe(DEFAULT_CUA_VM_NAME);
	});
});
