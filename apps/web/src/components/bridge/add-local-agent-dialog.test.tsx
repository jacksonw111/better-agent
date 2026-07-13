// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddLocalAgentDialog } from "./add-local-agent-dialog";

const store = vi.hoisted(() => ({
	createArgs: [] as Record<string, unknown>[],
	navigatedTo: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
	Link: ({
		children,
		to,
		...rest
	}: { children: ReactNode; to: string } & Record<string, unknown>) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@/utils/orpc", () => {
	const listTokensKey = ["bridge", "listTokens"];
	const listMemoriesKey = ["memory", "listMemories"];
	return {
		orpc: {
			bridge: {
				listTokens: { key: () => listTokensKey },
				createToken: {
					mutationOptions: (opts: Record<string, unknown>) => ({
						mutationFn: (args: Record<string, unknown>) => {
							store.createArgs.push(args);
							return Promise.resolve({
								id: "new-token",
								token: "bt_new",
								last4: "_new",
							});
						},
						...opts,
					}),
				},
			},
			memory: {
				listMemories: {
					queryOptions: () => ({
						queryKey: listMemoriesKey,
						queryFn: () => Promise.resolve([]),
					}),
				},
			},
		},
	};
});

function renderDialog() {
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<AddLocalAgentDialog />
		</QueryClientProvider>
	);
	return within(container.ownerDocument.body);
}

// Two triggers open the same dialog now (the toolbar button and the <md
// floating action button) — both share the accessible name "Add local
// agent", so open via the first (toolbar) one explicitly.
function openDialog(view: ReturnType<typeof within>) {
	fireEvent.click(view.getAllByRole("button", { name: "Add local agent" })[0]);
}

beforeEach(() => {
	store.createArgs.length = 0;
	store.navigatedTo.length = 0;
});

afterEach(() => {
	cleanup();
});

it("blocks Create until an agent kind is picked, then sends it", async () => {
	const view = renderDialog();
	openDialog(view);

	const create = await waitFor(() =>
		view.getByRole("button", { name: "Create" })
	);
	expect(create).toHaveProperty("disabled", true);

	// Cancel sits beside Create in the footer.
	expect(view.getByRole("button", { name: "Cancel" })).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Codex" }));
	expect(create).toHaveProperty("disabled", false);

	fireEvent.click(create);
	await waitFor(() => {
		expect(store.createArgs).toHaveLength(1);
	});
	expect(store.createArgs[0]?.agentKind).toBe("codex");
});

it("navigates to the new agent's /local workspace on success", async () => {
	const view = renderDialog();
	openDialog(view);

	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: "Claude Code" }))
	);
	fireEvent.click(view.getByRole("button", { name: "Create" }));

	await waitFor(() => {
		expect(store.navigatedTo).toHaveLength(1);
	});
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/local/$tokenId",
		params: { tokenId: "new-token" },
	});
});
