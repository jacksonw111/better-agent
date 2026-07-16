import type { ComputerControlSocket } from "@better-agent/api/computers/control-channel";
import { authenticateComputerWs } from "@better-agent/api/computers/ws-handshake";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";
import type { AgentServices } from "./app";
import { attachHeartbeat, type HeartbeatRaw } from "./ws-heartbeat";

// S2-T2 (design D4): the Computer control channel — the server pushes Launch
// Commands to a client-mode CLI over `GET /computer-ws`. Registered from
// index.ts (Node/Docker entry) with the SAME `upgradeWebSocket` instance as
// the other WS routes — see bridge-ws.ts's top comment for why a second
// `createNodeWebSocket({app})` is unsafe and why this can't live in buildApp.
//
// Auth mirrors bridge-ws.ts's shape: a plain middleware runs BEFORE
// `upgradeWebSocket(...)` and returns a genuine HTTP 401 before the handshake
// when the query's Ed25519 signature doesn't verify (see
// @better-agent/api/computers/ws-handshake.ts — same scheme as the x-ba-*
// header plane, carried in query params because a WS upgrade can't set custom
// headers). Client → server traffic is ws-level ping/pong only; the launch
// ack goes through oRPC (runs.ackLaunch), one code path for both delivery
// transports.

const HTTP_UNAUTHORIZED = 401;

function handshakeQuery(c: {
	req: { query(name: string): string | undefined };
}) {
	return {
		computerId: c.req.query("computerId"),
		sig: c.req.query("sig"),
		ts: c.req.query("ts"),
	};
}

export function registerComputerWsRoute(
	app: Hono<EvlogVariables>,
	upgradeWebSocket: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"],
	services: AgentServices
): void {
	const deps = {
		computerStore: services.stores.computer,
		replayGuard: services.computerReplayGuard,
	};
	app.get(
		"/computer-ws",
		async (c, next) => {
			const computer = await authenticateComputerWs(handshakeQuery(c), deps);
			if (!computer) {
				return c.text("Unauthorized", HTTP_UNAUTHORIZED);
			}
			return next();
		},
		upgradeWebSocket((c) => {
			const computerId = c.req.query("computerId") ?? "";
			let socket: ComputerControlSocket | null = null;
			let stopHeartbeat: (() => void) | null = null;
			return {
				onOpen: (_evt, ws) => {
					socket = { send: (data) => ws.send(data) };
					services.computerControl.register(computerId, socket);
					// Deliver anything already pending the moment the channel is up —
					// safe on reconnect: only still-`created` runs are ever pushed.
					services.computerControl
						.notifyComputer(computerId)
						.catch(() => undefined);
					stopHeartbeat = attachHeartbeat(ws.raw as HeartbeatRaw, () => {
						services.stores.computer
							.touch(computerId, new Date())
							.catch(() => undefined);
					});
				},
				onClose: () => {
					stopHeartbeat?.();
					if (socket) {
						services.computerControl.unregister(computerId, socket);
					}
				},
			};
		})
	);
}
