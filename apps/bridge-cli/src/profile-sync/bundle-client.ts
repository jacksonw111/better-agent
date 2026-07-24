import type { AppRouterClient } from "@better-agent/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ProfileBundle } from "./bundle";

// P1-C: the production `fetchBundle` — an oRPC client over the same bridge-token
// Bearer channel relay-transport.ts uses, calling `profiles.materializeBundle`.
// The `AppRouterClient` import is type-only, so this costs nothing at runtime.

const TRAILING_SLASH = /\/$/;

/** Returns a `fetchBundle` closure pulling the read-only Profile bundle for the
 * bridge token's owner. */
export function createBundleFetcher(config: {
	serverUrl: string;
	token: string;
}): () => Promise<ProfileBundle> {
	const link = new RPCLink({
		url: `${config.serverUrl.replace(TRAILING_SLASH, "")}/rpc`,
		headers: { authorization: `Bearer ${config.token}` },
	});
	const client = createORPCClient(link) as AppRouterClient;
	return () =>
		client.profiles.materializeBundle() as unknown as Promise<ProfileBundle>;
}
