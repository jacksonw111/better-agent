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

export interface RelayTransportConfig {
	serverUrl: string;
	token: string;
}

const TRAILING_SLASH = /\/$/;

/**
 * `RelayTransport.startSession` deliberately types `agentKind` as a plain
 * `string` so `relay-client.ts` stays decoupled from the server's router
 * types. Callers (see `args.ts`) already validate the value against
 * `AGENT_KINDS` before it ever reaches here, so this narrowing cast is safe.
 */
function toAgentKind(agentKind: string): AgentKind {
	return agentKind as AgentKind;
}

export function createRelayTransport(
	config: RelayTransportConfig
): RelayTransport {
	const link = new RPCLink({
		url: `${config.serverUrl.replace(TRAILING_SLASH, "")}/rpc`,
		headers: { authorization: `Bearer ${config.token}` },
	});
	const client = createORPCClient(link) as AppRouterClient;

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
	};
}
