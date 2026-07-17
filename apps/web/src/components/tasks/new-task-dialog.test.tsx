// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComputerListItem } from "@/utils/api-types";
import { NewTaskDialog } from "./new-task-dialog";
import { studioMac } from "./wizard-test-fixtures";

// The New Task modal shell: an untouched wizard closes silently, a draft
// with content asks "Discard this task?" first, and a confirmed discard
// resets everything so the next open starts clean at Step 1. The steps
// themselves are covered by new-task-wizard*.test.tsx.

const STUDIO_MAC = /Studio Mac/;
const DISCARD_TITLE = "Discard this task?";

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	openChanges: [] as boolean[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
	}: {
		children?: React.ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
	useNavigate: () => () => undefined,
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		computers: {
			list: {
				key: () => ["computers", "list"],
				queryOptions: () => ({
					queryKey: ["computers", "list"],
					queryFn: () => Promise.resolve(store.computers),
				}),
			},
		},
		tasks: {
			create: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: () =>
						Promise.resolve({ runId: "run-1", taskId: "task-1" }),
					...opts,
				}),
			},
		},
	},
}));

/** Controlled host mirroring TaskList: onOpenChange drives the open prop,
 * and a Reopen button lets tests open the same (still-mounted) dialog again
 * to prove the draft was reset. */
function Host() {
	const [open, setOpen] = useState(true);
	return (
		<>
			<button onClick={() => setOpen(true)} type="button">
				Reopen
			</button>
			<NewTaskDialog
				onOpenChange={(next) => {
					store.openChanges.push(next);
					setOpen(next);
				}}
				open={open}
			/>
		</>
	);
}

function renderDialog(computers: ComputerListItem[] = [studioMac]) {
	store.computers = computers;
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<Host />
		</QueryClientProvider>
	);
	return within(container.ownerDocument.body);
}

type View = ReturnType<typeof renderDialog>;

async function makeDraftDirty(view: View) {
	fireEvent.click(await view.findByRole("radio", { name: STUDIO_MAC }));
}

function clickClose(view: View) {
	fireEvent.click(view.getByRole("button", { name: "Close" }));
}

afterEach(() => {
	store.computers = [];
	store.openChanges.length = 0;
	cleanup();
});

it("closes silently when nothing has been filled in", async () => {
	const view = renderDialog();
	await view.findByRole("radio", { name: STUDIO_MAC });

	clickClose(view);

	expect(view.queryByText(DISCARD_TITLE)).toBeNull();
	expect(store.openChanges).toEqual([false]);
	await waitFor(() => {
		expect(view.queryByRole("radio", { name: STUDIO_MAC })).toBeNull();
	});
});

it("asks before discarding a draft with content, and Keep editing returns", async () => {
	const view = renderDialog();
	await makeDraftDirty(view);

	clickClose(view);

	// The modal did not close — it asked first.
	expect(view.getByText(DISCARD_TITLE)).toBeDefined();
	expect(store.openChanges).toEqual([]);

	fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
	await waitFor(() => {
		expect(view.queryByText(DISCARD_TITLE)).toBeNull();
	});
	// The draft survived: the computer is still selected.
	const radio = view.getByRole("radio", {
		name: STUDIO_MAC,
	}) as HTMLInputElement;
	expect(radio.checked).toBe(true);
});

it("discards, closes and starts clean at Step 1 on the next open", async () => {
	const view = renderDialog();
	await makeDraftDirty(view);

	clickClose(view);
	fireEvent.click(view.getByRole("button", { name: "Discard" }));

	expect(store.openChanges).toEqual([false]);
	await waitFor(() => {
		expect(view.queryByText(DISCARD_TITLE)).toBeNull();
	});

	fireEvent.click(view.getByRole("button", { name: "Reopen" }));
	const radio = (await view.findByRole("radio", {
		name: STUDIO_MAC,
	})) as HTMLInputElement;
	expect(radio.checked).toBe(false);
	// Step 1 is current again.
	const runtimeStep = view.getByText("Runtime").closest("li");
	expect(runtimeStep?.getAttribute("aria-current")).toBe("step");
});
