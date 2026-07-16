// The outer restart loop: wires shutdown signals, drives one bridge session
// to completion, and — on a server-issued `control: restart` — reconfigures
// and relaunches the agent IN PLACE under the SAME bridge sessionId instead
// of exiting. Split out of index.ts's `main` to keep both files under the
// line cap; see `runBridgeSession`'s doc comment in relay-client.ts for why
// it returns a `PollOutcome` instead of just ending the process itself.
import { agentSupportsImages } from "./adapters/session-capabilities";
import type { Adapter, AgentHandle } from "./adapters/types";
import type { BridgeCliArgs } from "./args";
import type { AfterIdRef } from "./commands";
import type { CuaController } from "./cua/cua-controller";
import { withFsReader } from "./fs-reader";
import { withGitRunner } from "./git-runner";
import { type ImageInputDeps, withImageInput } from "./image-input";
import type {
	AgentSessionIdRef,
	PollOutcome,
	RelayTransport,
} from "./relay-client";
import { runBridgeSession } from "./relay-client";
import { type ShellRunnerDeps, withShellRunner } from "./shell-runner";

export interface RunRestartLoopOptions {
	adapter: Adapter;
	args: BridgeCliArgs;
	/** `--cua` only: the desktop VM lifecycle, driven by the web's Start/Stop
	 * buttons. Lives here (across restarts) so an in-place agent restart doesn't
	 * kill the desktop. */
	cua?: CuaController;
	handle: AgentHandle;
	sessionId: string;
	/** S25-T1: an EXTERNAL abort that ends this loop like SIGINT would —
	 * task-launch sessions share the computer client's shutdown signal so a
	 * SIGINT aborts every run session, not just the process's own handlers.
	 * Optional: the pre-existing session mode never passes one. */
	signal?: AbortSignal;
	transport: RelayTransport;
}

/** Adds `startVm`/`stopVm` to a handle so the CommandSink dispatch can route the
 * web's Start/Stop desktop commands to the (restart-surviving) CUA controller.
 * Every other method is inherited from the real handle via the prototype.
 * Generic (P3-T2) because the handle it wraps is now the image layer's
 * `ImageInputHandle` (wire `ImageRef`s), not the adapter's raw `AgentHandle`. */
function withCua<H extends object>(
	handle: H,
	cua: CuaController | undefined
): H {
	if (!cua) {
		return handle;
	}
	const wrapped = Object.create(handle) as H & {
		startVm?: () => void;
		stopVm?: () => void;
	};
	wrapped.startVm = () => {
		cua.startVm().catch(() => undefined);
	};
	wrapped.stopVm = () => {
		cua.stopVm().catch(() => undefined);
	};
	return wrapped;
}

/** P3-T2: builds the image layer's deps for this session — download via the
 * transport's bridge-token-authed `getAttachment`, capability from the
 * adapter's own constant, failure notes pushed best-effort straight to the
 * server (same contract as session-watchdog-wiring.ts's `pushStalledStatus`). */
function buildImageInputDeps(
	args: BridgeCliArgs,
	transport: RelayTransport,
	sessionId: string
): ImageInputDeps {
	const { getAttachment } = transport;
	return {
		fetchImage: getAttachment
			? (attachmentId) => getAttachment({ attachmentId })
			: undefined,
		pushStatus: (event) => {
			transport
				.pushEvents({ sessionId, events: [event] })
				.catch(() => undefined);
		},
		supportsImages: agentSupportsImages(args.agentKind),
	};
}

/** P4-T2: the shell runner's deps for this session — commands run in the CLI's
 * validated workspace dir, and each event is pushed straight to the relay
 * (best-effort, same fire-and-forget contract as `buildImageInputDeps`'s
 * `pushStatus`) since these are out-of-band, not part of the agent's stream. */
function buildShellRunnerDeps(
	args: BridgeCliArgs,
	transport: RelayTransport,
	sessionId: string
): ShellRunnerDeps {
	return {
		dir: args.dir,
		pushEvent: (event) => {
			transport
				.pushEvents({ sessionId, events: [event] })
				.catch(() => undefined);
		},
	};
}

/** Builds the full CommandSink wrapper stack around a freshly-started handle:
 * image layer innermost (downloads a send's image refs), then the shell runner
 * (out-of-band `runShell`), then the fs reader (P4-T3's read-only
 * `fsList`/`fsRead`), then the git runner (P4-T4's `gitStatus`/`gitDiff`/
 * `gitCommit`) — all three wrappers' `{dir, pushEvent}` deps are structurally
 * the shell runner's, so `shellDeps` is shared — then CUA outermost (desktop
 * start/stop). Shared by the initial launch and every in-place relaunch so
 * the chain never drifts. */
function wrapHandle(
	handle: AgentHandle,
	imageDeps: ImageInputDeps,
	shellDeps: ShellRunnerDeps,
	cua: CuaController | undefined
) {
	return withCua(
		withGitRunner(
			withFsReader(
				withShellRunner(withImageInput(handle, imageDeps), shellDeps),
				shellDeps
			),
			shellDeps
		),
		cua
	);
}

function printConnected(sessionId: string): void {
	process.stdout.write(
		`Connected. Session ${sessionId}. Drive it from the web Local Agent view; input here is forwarded to the agent.\n`
	);
}

function printRestarted(sessionId: string): void {
	process.stdout.write(
		`Reconfigured and resumed. Session ${sessionId} is still connected.\n`
	);
}

/** Registers a one-shot SIGINT/SIGTERM handler that aborts `controller` and
 * stops whichever agent process is CURRENTLY running — `handleRef.current` is
 * swapped by the loop on every restart, so this closure always sees the
 * latest handle without being re-registered. */
function wireShutdown(
	controller: AbortController,
	handleRef: { current: Pick<AgentHandle, "stop"> }
): void {
	const stop = () => {
		controller.abort();
		handleRef.current.stop();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}

/** S25-T1: propagates an external abort (`RunRestartLoopOptions.signal`) into
 * the loop's own controller — same effect as `wireShutdown`'s signal
 * handlers, but drivable by the computer client (and by tests). */
function linkExternalAbort(
	signal: AbortSignal | undefined,
	controller: AbortController,
	handleRef: { current: Pick<AgentHandle, "stop"> }
): void {
	if (!signal) {
		return;
	}
	const stop = () => {
		controller.abort();
		handleRef.current.stop();
	};
	if (signal.aborted) {
		stop();
		return;
	}
	signal.addEventListener("abort", stop, { once: true });
}

function buildPollOptions(args: BridgeCliArgs) {
	return args.debug
		? {
				onCommands: (commands: unknown) =>
					process.stderr.write(`← command(s): ${JSON.stringify(commands)}\n`),
			}
		: undefined;
}

/** `generationId` is RC-fix1's per-launch idempotency-key salt (see
 * `forward-events.ts`'s doc comment on `ForwardEventsOptions.generationId`):
 * 0 for the initial process start, bumped by 1 for every in-place restart the
 * loop below drives under this SAME bridge sessionId. */
function buildForwardOptions(args: BridgeCliArgs, generationId: number) {
	return {
		generationId,
		onWarning: (message: string) => process.stderr.write(`${message}\n`),
		onEvent: args.debug
			? (event: unknown) =>
					process.stderr.write(`→ event: ${JSON.stringify(event)}\n`)
			: undefined,
	};
}

/** Re-fetches fresh persisted config and relaunches the agent with
 * `--resume` pointed at the underlying agent's own conversation id (falling
 * back to whatever `--resume` the CLI was originally launched with) — the
 * SAME bridge sessionId keeps driving the new process. */
async function relaunch(
	adapter: Adapter,
	args: BridgeCliArgs,
	transport: RelayTransport,
	agentSessionIdRef: AgentSessionIdRef
): Promise<AgentHandle> {
	const { config, mcpServers, skills } = await transport.fetchConfig();
	return adapter.start(args.dir, {
		resume: agentSessionIdRef.current ?? args.resume,
		config: config ?? undefined,
		mcpServers,
		skills,
	});
}

/**
 * Wires SIGINT/SIGTERM to a clean shutdown, then drives `runBridgeSession` to
 * completion — looping back to relaunch the agent (fresh config, `--resume`
 * pointed at the captured agent-side conversation id) whenever it returns the
 * `"restart"` outcome, instead of letting `main` exit. The bridge `sessionId`
 * and `transport` are reused across every iteration; only the `AgentHandle`
 * (and, by extension, the underlying agent process) is swapped out.
 */
export async function runRestartLoop(
	options: RunRestartLoopOptions
): Promise<void> {
	const { adapter, args, sessionId, transport, cua } = options;
	const controller = new AbortController();
	// P3-T2: the image layer wraps the raw adapter handle (innermost) so a
	// text command's image refs are downloaded before the adapter's send sees
	// them; withCua stays outermost, exactly as before.
	const imageDeps = buildImageInputDeps(args, transport, sessionId);
	const shellDeps = buildShellRunnerDeps(args, transport, sessionId);
	const handleRef = {
		current: wrapHandle(options.handle, imageDeps, shellDeps, cua),
	};
	const agentSessionIdRef: AgentSessionIdRef = {};
	// Hoisted here (NOT inside `runBridgeSession`) and passed into every
	// generation below: relay command reads are non-destructive and every
	// generation shares the same bridge sessionId, so a fresh cursor per
	// generation would make generation N+1 re-read (and re-dispatch) every
	// command generation N already handled, including the very
	// `control:restart` command that triggered this relaunch.
	const afterIdRef: AfterIdRef = { current: 0 };
	wireShutdown(controller, handleRef);
	linkExternalAbort(options.signal, controller, handleRef);

	let outcome: PollOutcome;
	let onStart = printConnected;
	// RC-fix1: bumped once per launch and threaded into forwardEvents as its
	// idempotency-key salt — see `buildForwardOptions`.
	let generation = 0;
	do {
		// Each iteration must finish (and, on "restart", relaunch) before the
		// next one can begin — sequential by design, not an oversight.
		const result = await runBridgeSession({
			transport,
			handle: handleRef.current,
			sessionId,
			signal: controller.signal,
			agentSessionIdRef,
			afterIdRef,
			onStart,
			pollOptions: buildPollOptions(args),
			forwardOptions: buildForwardOptions(args, generation),
		});
		generation += 1;
		outcome = result.outcome;
		if (outcome === "restart") {
			handleRef.current = wrapHandle(
				await relaunch(adapter, args, transport, agentSessionIdRef),
				imageDeps,
				shellDeps,
				cua
			);
			onStart = printRestarted;
		}
	} while (outcome === "restart");

	process.stdout.write(`Bridge session ended: ${sessionId}\n`);
}
