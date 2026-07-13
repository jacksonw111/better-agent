/**
 * Stateful CUA lifecycle for one bridge session, driven by the web's Start/Stop
 * desktop buttons (relayed as `control: startVm` / `stopVm` commands) and the
 * `--cua` auto-start. Wraps `startCuaSession` with idempotency so a second
 * "Start" while a VM is booting/running is a no-op, and lives OUTSIDE the agent
 * restart loop so an in-place agent restart never kills the desktop.
 */

import { type CuaSession, startCuaSession } from "./cua-session";

export interface CuaControllerOptions {
	/** `--cua-image`: image to pull only when the VM is absent. */
	image?: string;
	log: (message: string) => void;
	reportVnc?: (vncEndpoint: string | null) => Promise<void>;
	serverUrl: string;
	sessionId: string;
	token: string;
	/** `--cua-vm`: use this existing VM (skips the pull if it exists). */
	vmName?: string;
	/** `--cua-vnc-url`: relay this VNC directly instead of provisioning a VM. */
	vncUrlOverride?: string;
}

export interface CuaController {
	dispose: () => Promise<void>;
	startVm: () => Promise<void>;
	stopVm: () => Promise<void>;
}

export function createCuaController(opts: CuaControllerOptions): CuaController {
	let session: CuaSession | null = null;
	let starting: Promise<void> | null = null;

	const boot = async (): Promise<void> => {
		try {
			session = await startCuaSession({
				serverUrl: opts.serverUrl,
				token: opts.token,
				sessionId: opts.sessionId,
				log: opts.log,
				reportVnc: opts.reportVnc,
				vncUrlOverride: opts.vncUrlOverride,
				vmName: opts.vmName,
				image: opts.image,
			});
		} catch (error) {
			opts.log(error instanceof Error ? error.message : String(error));
			session = null;
		}
	};

	const startVm = async (): Promise<void> => {
		if (session || starting) {
			return;
		}
		starting = boot();
		await starting;
		starting = null;
	};

	const stopVm = async (): Promise<void> => {
		await starting;
		const current = session;
		session = null;
		await current?.stop();
	};

	return { startVm, stopVm, dispose: stopVm };
}
