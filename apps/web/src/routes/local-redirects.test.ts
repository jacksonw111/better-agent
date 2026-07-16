import { isRedirect } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { Route as BridgeIndexRoute } from "./bridge.index";
import { Route as LocalIndexRoute } from "./local.index";
import { Route as LocalAgentsTokenRoute } from "./local-agents.$tokenId";
import { Route as LocalAgentsIndexRoute } from "./local-agents.index";

// S3-T3: every retired local-agents entry point converges onto /tasks. The
// redirects live in `beforeLoad`, so invoking those handlers directly (the
// router passes context these ones never touch) captures the thrown redirect
// without spinning up a full router.
function redirectTargetOf(route: {
	options: { beforeLoad?: (ctx: never) => unknown };
}): string | undefined {
	try {
		route.options.beforeLoad?.({} as never);
	} catch (thrown) {
		if (isRedirect(thrown)) {
			return thrown.options.to;
		}
		throw thrown;
	}
	throw new Error("expected beforeLoad to throw a redirect");
}

it("redirects the retired /local list to /tasks", () => {
	expect(redirectTargetOf(LocalIndexRoute)).toBe("/tasks");
});

it("redirects the legacy /local-agents list to /tasks", () => {
	expect(redirectTargetOf(LocalAgentsIndexRoute)).toBe("/tasks");
});

it("redirects legacy /local-agents/$tokenId links to /tasks", () => {
	expect(redirectTargetOf(LocalAgentsTokenRoute)).toBe("/tasks");
});

it("redirects the ancient /bridge alias to /tasks", () => {
	expect(redirectTargetOf(BridgeIndexRoute)).toBe("/tasks");
});
