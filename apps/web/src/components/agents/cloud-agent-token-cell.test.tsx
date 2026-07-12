// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CloudAgentTokenCell } from "./cloud-agent-token-cell";

const TOKEN = "bt_cloudtoken1234";
const MASKED_PATTERN = /····/;
const LAST_FOUR_PATTERN = /…1234$/;
const ERROR_MESSAGE_PATTERN = /network down/;
const RETRY_CALL_COUNT = 2;

const store = vi.hoisted(() => ({
	getToken: vi.fn(
		(): Promise<string | null> => Promise.resolve("bt_cloudtoken1234")
	),
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		agents: {
			getToken: {
				queryOptions: ({ input }: { input: { id: string } }) => ({
					queryKey: ["agents", "getToken", input.id],
					queryFn: () => store.getToken(),
				}),
			},
		},
	},
}));

function renderCell(agentId = "agent-1") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<CloudAgentTokenCell agentId={agentId} />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		cell: within(container),
	};
}

afterEach(() => {
	store.getToken.mockReset();
	store.getToken.mockImplementation(() => Promise.resolve(TOKEN));
	cleanup();
});

it("shows a masked chip before opening and does not fetch the token", () => {
	const { cell } = renderCell();

	expect(cell.getByText(MASKED_PATTERN)).toBeDefined();
	expect(store.getToken).not.toHaveBeenCalled();
});

it("fetches lazily on open, then shows the full token with a copy action and upgrades the chip", async () => {
	const { body, cell } = renderCell();

	act(() => {
		fireEvent.click(cell.getByRole("button"));
	});

	expect(store.getToken).toHaveBeenCalledTimes(1);
	await waitFor(() => {
		expect(body.getByText(TOKEN)).toBeDefined();
	});
	expect(body.getByRole("button", { name: "Copy token" })).toBeDefined();
	expect(cell.getByText(LAST_FOUR_PATTERN)).toBeDefined();
});

it("shows an inline error with a retry button that refetches", async () => {
	store.getToken.mockReset();
	store.getToken.mockRejectedValueOnce(new Error("network down"));
	store.getToken.mockImplementation(() => Promise.resolve(TOKEN));
	const { body, cell } = renderCell();

	act(() => {
		fireEvent.click(cell.getByRole("button"));
	});

	await waitFor(() => {
		expect(body.getByText(ERROR_MESSAGE_PATTERN)).toBeDefined();
	});
	const retry = body.getByRole("button", { name: "Retry" });

	act(() => {
		fireEvent.click(retry);
	});

	await waitFor(() => {
		expect(body.getByText(TOKEN)).toBeDefined();
	});
	expect(store.getToken).toHaveBeenCalledTimes(RETRY_CALL_COUNT);
});

it("shows a muted no-token state when getToken resolves null and keeps the chip masked", async () => {
	store.getToken.mockReset();
	store.getToken.mockImplementation(() => Promise.resolve(null));
	const { body, cell } = renderCell();

	act(() => {
		fireEvent.click(cell.getByRole("button"));
	});

	await waitFor(() => {
		expect(body.getByText("No token")).toBeDefined();
	});
	expect(body.queryByRole("button", { name: "Copy token" })).toBeNull();
	expect(cell.getByText(MASKED_PATTERN)).toBeDefined();
});
