import type {
	ComposioAccountStore,
	OpenConnectorAccountStore,
} from "@better-agent/agent/ports";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import type { OpenConnectorService } from "@better-agent/agent/tool/openconnector-tools";
import { env } from "@better-agent/env/server";

import { createComposioService } from "./composio";
import { createGoogleOAuth } from "./google-oauth";
import { createOpenConnectorService } from "./openconnector";

/** Optional, env-gated integrations: return null when unconfigured. */

export function buildGoogleOAuth() {
	if (!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
		return null;
	}
	return createGoogleOAuth({
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
		redirectUri: `${env.WEB_URL}/auth/google/callback`,
	});
}

// Resolves a ComposioService for an admin-managed composio account. The account
// id is also the composio "user" scope: an account's connections, auth, and
// tools all live under its id. Memoized by (accountId, key) so a key rotation
// rebuilds the client.
export function buildComposioAccountResolver(accounts: ComposioAccountStore) {
	const cache = new Map<string, { key: string; service: ComposioService }>();
	return async (accountId: string): Promise<ComposioService | null> => {
		const key = await accounts.getApiKey(accountId);
		if (!key) {
			cache.delete(accountId);
			return null;
		}
		const cached = cache.get(accountId);
		if (cached?.key !== key) {
			cache.set(accountId, {
				key,
				service: createComposioService({ apiKey: key }),
			});
		}
		return cache.get(accountId)?.service ?? null;
	};
}

// Resolves an OpenConnectorService for an admin-managed open-connector account.
// Memoized by (accountId, secrets) so a baseUrl/token rotation rebuilds the
// client; an account whose secrets vanish is evicted and resolves to null.
export function buildOpenConnectorAccountResolver(
	accounts: OpenConnectorAccountStore
) {
	const cache = new Map<
		string,
		{ key: string; service: OpenConnectorService }
	>();
	return async (accountId: string): Promise<OpenConnectorService | null> => {
		const secrets = await accounts.getSecrets(accountId);
		if (!secrets) {
			cache.delete(accountId);
			return null;
		}
		const key = `${secrets.baseUrl}|${secrets.adminToken}|${secrets.runtimeToken}`;
		const cached = cache.get(accountId);
		if (cached?.key !== key) {
			cache.set(accountId, {
				key,
				service: createOpenConnectorService({
					baseUrl: secrets.baseUrl,
					adminToken: secrets.adminToken,
					runtimeToken: secrets.runtimeToken,
				}),
			});
		}
		return cache.get(accountId)?.service ?? null;
	};
}
