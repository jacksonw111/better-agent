import type { ComputerStore } from "@better-agent/agent/computer-ports";
import type {
	ProjectQueryCommand,
	WorkspaceQueryCommand,
} from "@better-agent/agent/project-ports";
import {
	buildPendingCommands,
	type PendingCommandDeps,
} from "./pending-commands";
import {
	createProjectQueryHub,
	type ProjectQueryHub,
} from "./project-query-hub";

// S2-T2 (design D4): the computer control channel's server half — an
// in-memory computerId → socket registry plus the push path. Deliberately
// in-process (like CommandBus): a WS connection always lives on the same Node
// process as the registry that can notify it, and the heartbeat
// pendingCommands fallback covers every no-WS/multi-process gap (≤10s).
// notifyComputer re-derives the pending set from the created-runs queue on
// every call, so a push after reconnect can only ever contain still-unacked
// Runs — idempotent by construction (§15.3). Acks do NOT travel over this
// socket: the client acks via oRPC (runs.ackLaunch), one code path for both
// delivery transports.

/** What the channel needs from a live /computer-ws connection. */
export interface ComputerControlSocket {
	send(data: string): void;
}

export interface ComputerControlChannelDeps extends PendingCommandDeps {
	computer: Pick<ComputerStore, "getById">;
}

export interface ComputerControlChannel {
	/** Pushes every pending control-channel command — clone_project + launch
	 * (as one JSON frame each) — to the Computer's registered socket; a no-op
	 * without one. */
	notifyComputer(computerId: string): Promise<void>;
	/** Q2: the in-memory park behind projects.query — lives on the channel
	 * because a parked query and the socket its frame travelled on share one
	 * Node process by construction (see project-query-hub.ts). */
	projectQueries: ProjectQueryHub;
	/** Registers the Computer's live socket, replacing any previous one. */
	register(computerId: string, socket: ComputerControlSocket): void;
	/** Q2: pushes one real-time project_query frame — NOT part of the
	 * pendingCommands derivation, never redelivered. False when the Computer
	 * has no live control socket (the caller fails fast instead of queueing). */
	sendProjectQuery(computerId: string, command: ProjectQueryCommand): boolean;
	/** DP-WS: pushes one real-time workspace_query frame (pty.query) — same
	 * WS-only contract as sendProjectQuery. False when the Computer has no live
	 * control socket. */
	sendWorkspaceQuery(
		computerId: string,
		command: WorkspaceQueryCommand
	): boolean;
	/** Removes the socket — only if it is still the registered one, so a
	 * stale (already-replaced) connection closing can't drop a live one. */
	unregister(computerId: string, socket: ComputerControlSocket): void;
}

export function createComputerControlChannel(
	deps: ComputerControlChannelDeps,
	options: { projectQueryTimeoutMs?: number } = {}
): ComputerControlChannel {
	const sockets = new Map<string, ComputerControlSocket>();
	return {
		projectQueries: createProjectQueryHub({
			timeoutMs: options.projectQueryTimeoutMs,
		}),
		sendProjectQuery(computerId, command) {
			const socket = sockets.get(computerId);
			if (!socket) {
				return false;
			}
			socket.send(JSON.stringify(command));
			return true;
		},
		sendWorkspaceQuery(computerId, command) {
			const socket = sockets.get(computerId);
			if (!socket) {
				return false;
			}
			socket.send(JSON.stringify(command));
			return true;
		},
		register(computerId, socket) {
			sockets.set(computerId, socket);
		},
		unregister(computerId, socket) {
			if (sockets.get(computerId) === socket) {
				sockets.delete(computerId);
			}
		},
		async notifyComputer(computerId) {
			const socket = sockets.get(computerId);
			if (!socket) {
				return;
			}
			const computer = await deps.computer.getById(computerId);
			if (!computer) {
				return;
			}
			const commands = await buildPendingCommands(deps, computer);
			for (const command of commands) {
				socket.send(JSON.stringify(command));
			}
		},
	};
}
