// Parses one relayed command's `data` (`unknown` on the wire) into either a
// plain-text send or an answer to a previously-emitted `ApprovalEvent`, and
// dispatches it to a `CommandSink` — split out of relay-client.ts to keep
// that file under the project's file-size limit.

import type { TextWhen } from "./adapters/types";
import {
	dispatchControlCommand,
	dispatchTextCommand,
} from "./command-dispatch";
import {
	type ControlCommand,
	isControlRecord,
	parseControlCommand,
} from "./commands-control";
import {
	type ImageRef,
	parseTextCommand,
	type TextCommand,
} from "./commands-text-when";
import { isRecord } from "./normalize/types";

/** One relayed command/event; mirrors `RelayEvent` from `@better-agent/agent/ports`. */
export interface RelayEvent {
	data: unknown;
	id: number;
}

/** The user's answer to a previously-emitted `ApprovalEvent`, to feed to the
 * agent via `answerApproval`. */
export interface ApprovalCommand {
	optionId: string;
	requestId: string;
	type: "approval";
}

export type ParsedCommand = ApprovalCommand | ControlCommand | TextCommand;

function isApprovalCommand(data: unknown): data is ApprovalCommand {
	return (
		isRecord(data) &&
		data.type === "approval" &&
		typeof data.requestId === "string" &&
		typeof data.optionId === "string"
	);
}

/**
 * Parses one relayed command's `data` (`unknown` on the wire) into a text
 * send, an approval answer, or a control command (see `commands-control.ts`).
 * Anything else is `null` and left undispatched.
 */
export function parseCommandText(data: unknown): ParsedCommand | null {
	if (typeof data === "string") {
		return parseTextCommand(data, undefined);
	}
	if (isApprovalCommand(data)) {
		return data;
	}
	if (isControlRecord(data)) {
		return parseControlCommand(data);
	}
	if (isRecord(data) && typeof data.text === "string") {
		return parseTextCommand(data.text, data.when, data.images);
	}
	return null;
}

/** Mutable so pollLoop can resume from the last seen id after a reconnect. */
export interface AfterIdRef {
	current: number;
}

/** The subset of `AgentHandle` `pollLoop` needs to dispatch a command — a
 * text send, an answer to a pending approval, or (optionally — most fakes in
 * tests only exercise send/answerApproval) a request to stop the agent, or
 * one of the Local Agent detail page's session controls. All four control
 * methods are optional: not every adapter supports them (see
 * `AgentHandle` in `apps/bridge-cli/src/adapters/types.ts`), and a command
 * routed to one an adapter doesn't implement is silently a no-op rather than
 * a crash. */
export interface CommandSink {
	answerApproval(requestId: string, optionId: string): void;
	/** R3-T3: the web's reply to a `question` event. An empty `answers` array
	 * means "reject" (opencode's `POST /question/:id/reject`), not "no answer
	 * for any question". Optional: only opencode-serve implements it. */
	answerQuestion?(requestId: string, answers: string[][]): void;
	/** Asks the agent for a normalized status snapshot; the adapter answers by
	 * pushing a `status_snapshot` status event (see
	 * `apps/bridge-cli/src/adapters/types.ts`'s `StatusSnapshotDetail`). Called
	 * for a `control: getStatus` command — the detail page's status line. */
	getStatus?(): void;
	/** Cancels the in-flight turn but leaves the session alive. Called for a
	 * `control: interrupt` command — the detail page's Stop/Interrupt
	 * button. */
	interrupt?(): void;
	/** Fetches and pushes the agent's past local conversations. Called for a
	 * `control: listSessions` command — the detail page's "Past
	 * conversations" button. */
	listSessions?(): void;
	/** P3-T2: `images` is the wire's id-based `ImageRef` list — the production
	 * sink (`withImageInput`, image-input.ts) downloads them into `AgentImage`s
	 * before the adapter sees them; fakes/tests that ignore the param keep
	 * working unchanged. */
	send(text: string, images?: ImageRef[]): void;
	/** R3-T1: sends under a specific busy-turn `TextWhen`; see `dispatchTextCommand`. */
	sendWith?(text: string, when: TextWhen, images?: ImageRef[]): void;
	/** Changes the model used for subsequent turns. Called for a
	 * `control: setModel` command. */
	setModel?(model: string): void;
	/** Changes the session's permission mode. Called for a
	 * `control: setPermissionMode` command. */
	setPermissionMode?(mode: string): void;
	/** Changes the extended-thinking/reasoning effort level. Called for a
	 * `control: setThinking` command (R2-T3 item 2 — pi's
	 * `set_thinking_level`). */
	setThinking?(level: string): void;
	/** `--cua` only: provision + boot the local VM and open its VNC. Called for
	 * a `control: startVm` command — the detail page's "Start desktop" button. */
	startVm?(): void;
	/** Stops the agent process. Called for a `control: stop` command; see
	 * `AgentHandle.stop` in `apps/bridge-cli/src/adapters/types.ts`, which the
	 * real sink (the running session's `handle`) always implements. */
	stop?(): void;
	/** `--cua` only: tear the VNC relay down and stop the VM. Called for a
	 * `control: stopVm` command — the detail page's "Stop desktop" button. */
	stopVm?(): void;
}

/** What `dispatchCommands` did with a batch of relayed commands. */
export interface DispatchResult {
	/** A `control: restart` command was seen — the caller (`pollLoop`) should
	 * end with a "restart" `PollOutcome` instead of "stopped", so the outer
	 * restart loop relaunches the agent instead of exiting the process.
	 * Tracked independently of `stopRequested`, not merged into it. */
	restartRequested: boolean;
	/** A `control: stop` command was seen — the caller (`pollLoop`) should
	 * stop polling and wind the session down instead of scheduling another
	 * poll. */
	stopRequested: boolean;
	/** Whether any commands were seen at all (used by `pollLoop` to decide
	 * whether to speed back up or keep backing off). */
	wasActive: boolean;
}

/** Parses and dispatches each command to `sink` — text via
 * `dispatchTextCommand`, approval via `sink.answerApproval`, control via
 * `dispatchControlCommand` — advancing `afterIdRef` past every command seen
 * either way. */
export function dispatchCommands(
	commands: RelayEvent[],
	sink: CommandSink,
	afterIdRef: AfterIdRef
): DispatchResult {
	let stopRequested = false;
	let restartRequested = false;
	for (const command of commands) {
		const parsed = parseCommandText(command.data);
		if (parsed?.type === "text") {
			dispatchTextCommand(sink, parsed.text, parsed.when, parsed.images);
		} else if (parsed?.type === "approval") {
			sink.answerApproval(parsed.requestId, parsed.optionId);
		} else if (parsed?.type === "control") {
			dispatchControlCommand(parsed, sink);
			stopRequested = stopRequested || parsed.action === "stop";
			restartRequested = restartRequested || parsed.action === "restart";
		}
		afterIdRef.current = command.id;
	}
	return { restartRequested, stopRequested, wasActive: commands.length > 0 };
}
