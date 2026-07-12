import { useRouterState } from "@tanstack/react-router";

/** True on <md when a specific conversation is open on `/chat` — a cloud agent
 * (`?agentId`) or a local agent (`?localAgentId`) is selected. The agent-picker
 * grid at bare `/chat` is NOT immersive, so it keeps the dock.
 *
 * Derived ONLY from pathname + search (static per route) — never from scroll or
 * the dock's hidden state — so nothing here can feed the dock-oscillation loop
 * that commit 1d89402 fixed. Both the floating dock (suppressed) and the shell's
 * bottom padding (dropped) key off this same predicate. */
export function useImmersiveChat(): boolean {
	return useRouterState({
		select: (state) => {
			if (state.location.pathname !== "/chat") {
				return false;
			}
			const search = state.location.search as {
				agentId?: string;
				localAgentId?: string;
			};
			return Boolean(search.agentId || search.localAgentId);
		},
	});
}
