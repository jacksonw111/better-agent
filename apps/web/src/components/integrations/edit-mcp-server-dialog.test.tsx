// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpServerRow } from "@/utils/api-types";
import { EditMcpServerDialog } from "./edit-mcp-server-dialog";

const store = vi.hoisted(() => ({
	updateArgs: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		mcp: {
			listServers: { key: () => ["mcp", "listServers"] },
			updateServer: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.updateArgs.push(args);
						return Promise.resolve({ ...args, id: "srv-1" });
					},
					...opts,
				}),
			},
		},
	},
}));

const SERVER: McpServerRow = {
	id: "srv-1",
	userId: "user-1",
	name: "X API",
	url: "https://api.x.com/mcp",
	authLast4: "1234",
	createdAt: new Date("2026-07-01T00:00:00Z"),
};

function renderDialog(server: McpServerRow = SERVER) {
	const queryClient = new QueryClient();
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<EditMcpServerDialog server={server} />
		</QueryClientProvider>
	);
	const view = within(container.ownerDocument.body);
	fireEvent.click(view.getByRole("button", { name: "Edit server" }));
	return view;
}

beforeEach(() => {
	store.updateArgs.length = 0;
});

afterEach(cleanup);

it("prefills name/url from the server, and the token field shows the current last4 as a placeholder", () => {
	const view = renderDialog();
	expect(view.getByLabelText("Name")).toHaveProperty("value", "X API");
	expect(view.getByLabelText("URL")).toHaveProperty(
		"value",
		"https://api.x.com/mcp"
	);
	const token = view.getByLabelText("Bearer token (optional)");
	expect(token).toHaveProperty("value", "");
	expect(token.getAttribute("placeholder")).toBe("Unchanged (••••1234)");
});

it("saves edited name/url with an unchanged token (bearerToken omitted)", async () => {
	const view = renderDialog();
	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "X API v2" },
	});
	fireEvent.click(view.getByRole("button", { name: "Save changes" }));

	await waitFor(() => expect(store.updateArgs).toHaveLength(1));
	expect(store.updateArgs[0]).toMatchObject({
		serverId: "srv-1",
		name: "X API v2",
		url: "https://api.x.com/mcp",
		bearerToken: undefined,
	});
});

it("sends a new bearerToken when the owner types one", async () => {
	const view = renderDialog();
	fireEvent.change(view.getByLabelText("Bearer token (optional)"), {
		target: { value: "tok_new" },
	});
	fireEvent.click(view.getByRole("button", { name: "Save changes" }));

	await waitFor(() => expect(store.updateArgs).toHaveLength(1));
	expect(store.updateArgs[0]).toMatchObject({ bearerToken: "tok_new" });
});

it("clears the token (bearerToken: null) when the owner removes it, with an undo", async () => {
	const view = renderDialog();
	fireEvent.click(view.getByRole("button", { name: "Remove token" }));
	expect(view.getByText("Token will be removed")).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Undo" }));
	expect(view.getByLabelText("Bearer token (optional)")).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Remove token" }));
	fireEvent.click(view.getByRole("button", { name: "Save changes" }));

	await waitFor(() => expect(store.updateArgs).toHaveLength(1));
	expect(store.updateArgs[0]).toMatchObject({ bearerToken: null });
});

it("has no 'Remove token' action for a server that has no token set", () => {
	const view = renderDialog({ ...SERVER, authLast4: null });
	expect(view.queryByRole("button", { name: "Remove token" })).toBeNull();
	expect(
		view.getByLabelText("Bearer token (optional)").getAttribute("placeholder")
	).toBe("Bearer token");
});
