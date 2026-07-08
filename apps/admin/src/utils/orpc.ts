import type { AppRouter } from "@better-agent/api/routers/index";
import { env } from "@better-agent/env/web";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	clearTokens,
	getAccessToken,
	loadRefreshToken,
	setTokens,
} from "@/utils/auth";

// 查询数据保鲜时间：1 分钟
const STALE_TIME_MS = 60_000;

export function createQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				toast.error(`Error: ${error.message}`, {
					action: {
						label: "retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
		defaultOptions: { queries: { staleTime: STALE_TIME_MS } },
	});
}

// A bare link with no interceptors, used only to call auth.refresh so the
// refresh request itself cannot recurse into the refresh interceptor.
const refreshLink = new RPCLink({ url: `${env.VITE_SERVER_URL}/rpc` });
const refreshClient = createORPCClient(refreshLink) as RouterClient<AppRouter>;

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
	const refreshToken = loadRefreshToken();
	if (!refreshToken) {
		return false;
	}
	try {
		const result = await refreshClient.auth.refresh({ refreshToken });
		setTokens(result);
		return true;
	} catch {
		clearTokens();
		return false;
	}
}

function isUnauthorized(error: unknown): boolean {
	return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

// Session is gone (refresh failed) — send the user back to login. A hard
// navigation is fine here: it tears down all stale in-memory state. Mirrors
// apps/web's orpc.ts so admin also auto-redirects on token expiry.
function redirectToLogin(): void {
	if (typeof window === "undefined") {
		return;
	}
	if (window.location.pathname.startsWith("/login")) {
		return;
	}
	window.location.href = "/login";
}

const link = new RPCLink({
	url: `${env.VITE_SERVER_URL}/rpc`,
	headers: () => {
		const token = getAccessToken();
		return token ? { authorization: `Bearer ${token}` } : {};
	},
	interceptors: [
		async ({ next }) => {
			try {
				return await next();
			} catch (error) {
				if (isUnauthorized(error)) {
					if (!refreshInFlight) {
						refreshInFlight = refreshAccessToken().finally(() => {
							refreshInFlight = null;
						});
					}
					const ok = await refreshInFlight;
					if (ok) {
						return await next();
					}
					redirectToLogin();
				}
				throw error;
			}
		},
	],
});

export const client: RouterClient<AppRouter> = createORPCClient(
	link
) as RouterClient<AppRouter>;

export const orpc = createTanstackQueryUtils(client);
