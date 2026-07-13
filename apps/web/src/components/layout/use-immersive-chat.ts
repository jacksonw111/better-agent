import { useRouterState } from "@tanstack/react-router";

/** True on <md when a specific conversation is open — a cloud agent on
 * `/chat?agentId=…` or a local agent's workspace at `/local/$tokenId`. The
 * agent-picker grid at bare `/chat` and the `/local` list are NOT immersive,
 * so they keep the dock.
 *
 * Derived ONLY from pathname + search (static per route) — never from scroll or
 * the dock's hidden state — so nothing here can feed the dock-oscillation loop
 * that commit 1d89402 fixed. Both the floating dock (suppressed) and the shell's
 * bottom padding (dropped) key off this same predicate. */
export function useImmersiveChat(): boolean {
	return useRouterState({
		select: (state) => {
			const { pathname } = state.location;
			if (pathname.startsWith("/local/")) {
				return true;
			}
			if (pathname !== "/chat") {
				return false;
			}
			const search = state.location.search as { agentId?: string };
			return Boolean(search.agentId);
		},
	});
}
