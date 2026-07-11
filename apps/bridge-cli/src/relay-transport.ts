// Real network implementation of RelayTransport, calling the server's
// `bridge:` oRPC router over plain fetch. Uses `@orpc/client`'s `RPCLink` +
// `createORPCClient` rather than hand-rolled fetch POSTs: it's already a
// workspace dependency (see packages/client/src/internal.ts, which follows
// the identical pattern for the published agent-client SDK), it guarantees
// wire-format compatibility with the server's `RPCHandler` for free, and the
// `AppRouter` type import is type-only so it costs nothing at runtime or
// build time — no browser-only or heavy dependencies are pulled in.
import type { AppRouterClient } from "@better-agent/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AgentKind } from "./adapters/types";
import type { RelayTransport } from "./relay-client";
import { connectDuplexChannel, type DuplexChannel } from "./ws-duplex";
import { defaultWsFactory, type WsFactory } from "./ws-duplex-socket";

export interface RelayTransportConfig {
	serverUrl: string;
	token: string;
	/** R0-T2: overridable for tests — the real transport always defaults to
	 * `defaultWsFactory` (the `ws` package). See `ws-duplex-socket.ts`. */
	wsFactory?: WsFactory;
}

const TRAILING_SLASH = /\/$/;
// http(s):// -> ws(s):// — matches both "http" and "https" in one go, since
// replacing just the "http" prefix leaves an "s" (if any) in place: "https"
// becomes "wss", not "wsss".
const HTTP_SCHEME_PREFIX = /^http/;

/**
 * `RelayTransport.startSession` deliberately types `agentKind` as a plain
 * `string` so `relay-client.ts` stays decoupled from the server's router
 * types. Callers (see `args.ts`) already validate the value against
 * `AGENT_KINDS` before it ever reaches here, so this narrowing cast is safe.
 */
function toAgentKind(agentKind: string): AgentKind {
	return agentKind as AgentKind;
}

/** Derives the `GET /bridge/ws` URL (see `apps/server/src/bridge-ws.ts`) from
 * the same `serverUrl` the HTTP oRPC link uses. */
function toWsUrl(serverUrl: string): string {
	const trimmed = serverUrl.replace(TRAILING_SLASH, "");
	return `${trimmed.replace(HTTP_SCHEME_PREFIX, "ws")}/bridge/ws`;
}

export function createRelayTransport(
	config: RelayTransportConfig
): RelayTransport {
	const link = new RPCLink({
		url: `${config.serverUrl.replace(TRAILING_SLASH, "")}/rpc`,
		headers: { authorization: `Bearer ${config.token}` },
	});
	const client = createORPCClient(link) as AppRouterClient;
	const wsUrl = toWsUrl(config.serverUrl);
	const wsFactory = config.wsFactory ?? defaultWsFactory;

	return {
		startSession: (input) =>
			client.bridge.startSession({
				...input,
				agentKind: toAgentKind(input.agentKind),
			}),
		pushEvents: async (input) => {
			await client.bridge.pushEvents(input);
		},
		pollCommands: (input) => client.bridge.pollCommands(input),
		fetchConfig: () => client.bridge.fetchConfig(),
		openDuplex: (input): Promise<DuplexChannel | null> =>
			connectDuplexChannel({
				afterId: input.afterId,
				headers: { authorization: `Bearer ${config.token}` },
				sessionId: input.sessionId,
				url: wsUrl,
				wsFactory,
			}),
	};
}
