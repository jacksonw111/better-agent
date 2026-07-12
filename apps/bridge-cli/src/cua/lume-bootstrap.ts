/**
 * Auto-provisions the local Cua prerequisites so a user never configures lume
 * by hand — `agent-cli --cua` calls `ensureCuaEnvironment` and, in order:
 *   1. verifies the host can run lume (macOS on Apple Silicon),
 *   2. installs the `lume` binary if it's missing (official installer script),
 *   3. starts `lume serve` if its HTTP API isn't already answering on :7777,
 *   4. makes sure the target VM image exists (pulls it if not).
 *
 * Everything the module does to the outside world (spawn processes, sleep, talk
 * to lume) is injected, so the orchestration is unit-testable without a real VM
 * or a macOS host. The heavy, machine-specific steps (install, image pull) are
 * shelled out; this module only sequences and health-checks them.
 */

import type { LumeClient, LumeVm } from "./lume-client";

/** Official one-line installer (see https://cua.ai/docs/lume). */
export const LUME_INSTALL_URL =
	"https://raw.githubusercontent.com/trycua/cua/main/libs/lume/scripts/install.sh";
/** Default sandbox image + VM name the CUA session provisions. */
export const DEFAULT_CUA_IMAGE = "macos-sequoia-cua:latest";
export const DEFAULT_CUA_VM_NAME = "better-agent-cua";

const SERVE_POLL_INTERVAL_MS = 1000;
const SERVE_POLL_ATTEMPTS = 60;

export interface ExecResult {
	code: number;
	stderr: string;
	stdout: string;
}

export interface LumeBootstrapDeps {
	arch: string;
	/** Run a command to completion, returning its exit code + captured output. */
	exec: (command: string, args: string[]) => Promise<ExecResult>;
	log: (message: string) => void;
	lume: LumeClient;
	platform: NodeJS.Platform;
	sleep: (ms: number) => Promise<void>;
	/** Start a long-lived process detached (used for `lume serve`). */
	spawnDetached: (command: string, args: string[]) => void;
}

export interface EnsureCuaOptions {
	image?: string;
	vmName?: string;
}

export interface EnsureCuaResult {
	image: string;
	vmName: string;
}

function assertSupportedHost(deps: LumeBootstrapDeps): void {
	if (deps.platform !== "darwin" || deps.arch !== "arm64") {
		throw new Error(
			"CUA requires macOS on Apple Silicon (lume runs macOS/Linux VMs via the Apple Virtualization framework). " +
				`This host is ${deps.platform}/${deps.arch}.`
		);
	}
}

async function isLumeInstalled(deps: LumeBootstrapDeps): Promise<boolean> {
	try {
		const result = await deps.exec("lume", ["--version"]);
		return result.code === 0;
	} catch {
		return false;
	}
}

async function installLume(deps: LumeBootstrapDeps): Promise<void> {
	deps.log("lume not found — installing (one-time)…");
	const result = await deps.exec("/bin/sh", [
		"-c",
		`curl -fsSL ${LUME_INSTALL_URL} | bash`,
	]);
	if (result.code !== 0) {
		throw new Error(
			`lume install failed (exit ${result.code}): ${result.stderr.trim() || "see output above"}`
		);
	}
}

async function isServeUp(deps: LumeBootstrapDeps): Promise<boolean> {
	try {
		await deps.lume.list();
		return true;
	} catch {
		return false;
	}
}

async function ensureServe(deps: LumeBootstrapDeps): Promise<void> {
	if (await isServeUp(deps)) {
		return;
	}
	deps.log("starting `lume serve`…");
	deps.spawnDetached("lume", ["serve"]);
	for (let attempt = 0; attempt < SERVE_POLL_ATTEMPTS; attempt += 1) {
		await deps.sleep(SERVE_POLL_INTERVAL_MS);
		if (await isServeUp(deps)) {
			return;
		}
	}
	throw new Error(
		`lume serve did not become reachable after ${SERVE_POLL_ATTEMPTS}s`
	);
}

function vmExists(vms: LumeVm[], vmName: string): boolean {
	return vms.some((vm) => vm.name === vmName);
}

async function ensureVmImage(
	deps: LumeBootstrapDeps,
	vmName: string,
	image: string
): Promise<void> {
	const vms = await deps.lume.list();
	if (vmExists(vms, vmName)) {
		return;
	}
	deps.log(`pulling VM image ${image} as "${vmName}" (first run is large)…`);
	const result = await deps.exec("lume", ["pull", image, "--name", vmName]);
	if (result.code !== 0) {
		throw new Error(
			`lume pull failed (exit ${result.code}): ${result.stderr.trim() || image}`
		);
	}
}

/** Runs the full provisioning sequence, returning the VM name/image the caller
 * should then `run`. Idempotent: re-running with lume already set up is cheap
 * (a version check + one `list`). */
export async function ensureCuaEnvironment(
	deps: LumeBootstrapDeps,
	options: EnsureCuaOptions = {}
): Promise<EnsureCuaResult> {
	const vmName = options.vmName ?? DEFAULT_CUA_VM_NAME;
	const image = options.image ?? DEFAULT_CUA_IMAGE;
	assertSupportedHost(deps);
	if (!(await isLumeInstalled(deps))) {
		await installLume(deps);
	}
	await ensureServe(deps);
	await ensureVmImage(deps, vmName, image);
	deps.log("CUA environment ready.");
	return { vmName, image };
}
