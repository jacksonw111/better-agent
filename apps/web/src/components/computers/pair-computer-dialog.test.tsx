// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PairComputerDialog } from "./pair-computer-dialog";

const SHOWN_ONCE_PATTERN = /shown only once/i;
const TTL_PATTERN = /10 minutes/;
const APPEARS_IN_LIST_PATTERN = /appears in the list/i;
const OWN_CODE_PER_MACHINE_PATTERN = /its own one-time code/i;
const CODE_PATTERN = /pc_test123/;
const FRESH_CODE_PATTERN = /pc_fresh456/;
const CALLS_AFTER_REOPEN = 2;
const CALLS_AFTER_REGENERATE = 2;

const store = vi.hoisted(() => ({
	createCalls: 0,
	createError: null as Error | null,
	nextCode: "pc_test123",
	toastErrors: [] as string[],
}));

vi.mock("sonner", () => ({
	toast: {
		error: (message: string) => {
			store.toastErrors.push(message);
		},
	},
}));

vi.mock("@better-agent/env/web", () => ({
	env: { VITE_SERVER_URL: "https://server.example.com" },
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		computers: {
			createPairingCode: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: () => {
						store.createCalls += 1;
						return store.createError
							? Promise.reject(store.createError)
							: Promise.resolve({
									code: store.nextCode,
									expiresAt: new Date("2026-07-15T12:10:00.000Z"),
								});
					},
					...opts,
				}),
			},
		},
	},
}));

function renderDialog() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<PairComputerDialog />
		</QueryClientProvider>
	);
	return within(container.ownerDocument.body);
}

afterEach(() => {
	store.createCalls = 0;
	store.createError = null;
	store.nextCode = "pc_test123";
	store.toastErrors.length = 0;
	cleanup();
});

it("generates a code on open and shows the one-time pairing command", async () => {
	const body = renderDialog();

	fireEvent.click(body.getByRole("button", { name: "Pair new computer" }));

	await waitFor(() => {
		expect(
			body.getByText(
				"agent-cli --client --pair pc_test123 --server https://server.example.com"
			)
		).toBeDefined();
	});
	expect(store.createCalls).toBe(1);
	expect(body.getByRole("button", { name: "Copy command" })).toBeDefined();
	// One-time + expiry warning, and the "wait for it to appear" hint (the
	// list refetches every 10s — there is no extra polling channel).
	expect(body.getByText(SHOWN_ONCE_PATTERN)).toBeDefined();
	expect(body.getByText(TTL_PATTERN)).toBeDefined();
	expect(body.getByText(APPEARS_IN_LIST_PATTERN)).toBeDefined();
	// Multi-computer guidance: every machine needs its own one-time code.
	expect(body.getByText(OWN_CODE_PER_MACHINE_PATTERN)).toBeDefined();
});

it("regenerates a fresh code in place via the Generate new code button", async () => {
	const body = renderDialog();

	fireEvent.click(body.getByRole("button", { name: "Pair new computer" }));
	await waitFor(() => {
		expect(body.getByText(CODE_PATTERN)).toBeDefined();
	});

	store.nextCode = "pc_fresh456";
	fireEvent.click(body.getByRole("button", { name: "Generate new code" }));

	await waitFor(() => {
		expect(body.getByText(FRESH_CODE_PATTERN)).toBeDefined();
	});
	expect(body.queryByText(CODE_PATTERN)).toBeNull();
	expect(store.createCalls).toBe(CALLS_AFTER_REGENERATE);
});

it("generates a fresh code each time the dialog is opened", async () => {
	const body = renderDialog();

	fireEvent.click(body.getByRole("button", { name: "Pair new computer" }));
	await waitFor(() => {
		expect(body.getByText(CODE_PATTERN)).toBeDefined();
	});
	fireEvent.click(body.getByRole("button", { name: "Done" }));
	await waitFor(() => {
		expect(body.queryByText(CODE_PATTERN)).toBeNull();
	});

	fireEvent.click(body.getByRole("button", { name: "Pair new computer" }));
	await waitFor(() => {
		expect(store.createCalls).toBe(CALLS_AFTER_REOPEN);
	});
});

it("surfaces a generation failure as an error toast with a retry", async () => {
	store.createError = new Error("rate limited");
	const body = renderDialog();

	fireEvent.click(body.getByRole("button", { name: "Pair new computer" }));

	await waitFor(() => {
		expect(store.toastErrors).toEqual(["rate limited"]);
	});
	const retry = body.getByRole("button", { name: "Try again" });
	store.createError = null;
	fireEvent.click(retry);
	await waitFor(() => {
		expect(body.getByText(CODE_PATTERN)).toBeDefined();
	});
});
