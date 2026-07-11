// The outer restart loop: wires shutdown signals, drives one bridge session
// to completion, and — on a server-issued `control: restart` — reconfigures
// and relaunches the agent IN PLACE under the SAME bridge sessionId instead
// of exiting. Split out of index.ts's `main` to keep both files under the
// line cap; see `runBridgeSession`'s doc comment in relay-client.ts for why
// it returns a `PollOutcome` instead of just ending the process itself.
import type { Adapter, AgentHandle } from "./adapters/types";
import type { BridgeCliArgs } from "./args";
import type { AfterIdRef } from "./commands";
import type {
	AgentSessionIdRef,
	PollOutcome,
	RelayTransport,
} from "./relay-client";
import { runBridgeSession } from "./relay-client";

export interface RunRestartLoopOptions {
	adapter: Adapter;
	args: BridgeCliArgs;
	handle: AgentHandle;
	sessionId: string;
	transport: RelayTransport;
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
	handleRef: { current: AgentHandle }
): void {
	const stop = () => {
		controller.abort();
		handleRef.current.stop();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
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
	const { config, mcpServers } = await transport.fetchConfig();
	return adapter.start(args.dir, {
		resume: agentSessionIdRef.current ?? args.resume,
		config: config ?? undefined,
		mcpServers,
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
	const { adapter, args, sessionId, transport } = options;
	const controller = new AbortController();
	const handleRef = { current: options.handle };
	const agentSessionIdRef: AgentSessionIdRef = {};
	// Hoisted here (NOT inside `runBridgeSession`) and passed into every
	// generation below: relay command reads are non-destructive and every
	// generation shares the same bridge sessionId, so a fresh cursor per
	// generation would make generation N+1 re-read (and re-dispatch) every
	// command generation N already handled, including the very
	// `control:restart` command that triggered this relaunch.
	const afterIdRef: AfterIdRef = { current: 0 };
	wireShutdown(controller, handleRef);

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
			handleRef.current = await relaunch(
				adapter,
				args,
				transport,
				agentSessionIdRef
			);
			onStart = printRestarted;
		}
	} while (outcome === "restart");

	process.stdout.write(`Bridge session ended: ${sessionId}\n`);
}
