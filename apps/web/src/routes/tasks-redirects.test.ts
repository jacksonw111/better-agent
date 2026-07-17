import { isRedirect } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { Route as TasksIndexRoute } from "./tasks.index";
import { Route as TasksNewRoute } from "./tasks.new";

// P3: the task list and the wizard deep link both retired — the product
// surface is computer -> agent -> sessions, so both URLs land on /computers.
// Same direct-beforeLoad harness as local-redirects.test.ts.
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

it("redirects the retired /tasks list to /computers", () => {
	expect(redirectTargetOf(TasksIndexRoute)).toBe("/computers");
});

it("redirects the retired /tasks/new wizard deep link to /computers", () => {
	expect(redirectTargetOf(TasksNewRoute)).toBe("/computers");
});
