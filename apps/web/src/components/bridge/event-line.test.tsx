// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ApprovalEvent } from "./bridge-events";
import { ApprovalLine } from "./event-line";

const BASE_APPROVAL_EVENT: ApprovalEvent = {
	kind: "approval",
	options: [{ id: "accept", label: "Allow" }],
	requestId: "req_1",
	title: "Run command?",
};

function renderApproval(event: ApprovalEvent) {
	const { container } = render(<ApprovalLine event={event} />);
	return { ...within(container), container };
}

// R3-T2: arbitrary offsets from "now" for a not-yet-expired vs. an
// already-expired timeoutAt — a minute ahead, a second behind.
const FUTURE_TIMEOUT_OFFSET_MS = 60_000;
const PAST_TIMEOUT_OFFSET_MS = 1000;

const SUMMARY_TEXT_PATTERN = /\d+ files?:/;

// R3-T2: codex fileChange approval requests carry a change-summary line.
it("renders event.summary as a muted line under the title when present", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		summary: "2 files: 1 added, 1 modified (a.ts, b.ts)",
	});
	const summary = view.getByText("2 files: 1 added, 1 modified (a.ts, b.ts)");
	expect(summary.dataset.slot).toBe("approval-summary");
});

it("renders no summary line when event.summary is absent", () => {
	const view = renderApproval(BASE_APPROVAL_EVENT);
	expect(view.queryByText(SUMMARY_TEXT_PATTERN, { exact: false })).toBeNull();
});

// R3-T2: presentApproval (apps/bridge-cli/src/adapters/approvals.ts) stamps
// timeoutAt; the card shows a shrinking countdown bar until then.
it("renders a countdown bar when timeoutAt is in the future", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() + FUTURE_TIMEOUT_OFFSET_MS,
	});
	const bar = view.container.querySelector('[data-slot="approval-countdown"]');
	expect(bar).not.toBeNull();
});

it("renders no countdown bar when timeoutAt is absent", () => {
	const view = renderApproval(BASE_APPROVAL_EVENT);
	expect(
		view.container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
});

it("shows the expiry notice instead of the bar once timeoutAt has passed", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() - PAST_TIMEOUT_OFFSET_MS,
	});
	expect(view.getByText("已超时，按拒绝处理")).toBeDefined();
	expect(
		view.container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
});

// R3-4 review finding 4: a remount mid-window (e.g. the page refreshes while
// a card is still pending) must not restart the bar at 100% — it should
// resume from the actual remaining fraction of the CLI's timeoutMs window.
it("initializes the countdown bar from the remaining fraction on mount, not always 100%", () => {
	const totalMs = 5 * 60_000; // mirrors bridge-cli's APPROVAL_TIMEOUT_MS
	const remainingMs = 60_000; // 1 of 5 minutes left
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() + remainingMs,
		timeoutMs: totalMs,
	});
	const fill = view.container.querySelector(
		'[data-slot="approval-countdown-fill"]'
	);
	const width = Number.parseFloat((fill as HTMLElement).style.width);
	expect(width).toBeGreaterThan(0);
	expect(width).toBeLessThan(100);
});

it("derives the countdown's total window from a fallback constant (matching the CLI's APPROVAL_TIMEOUT_MS) when timeoutMs is absent", () => {
	const remainingMs = 60_000; // 1 of a 5-minute fallback window
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() + remainingMs,
	});
	const fill = view.container.querySelector(
		'[data-slot="approval-countdown-fill"]'
	);
	const width = Number.parseFloat((fill as HTMLElement).style.width);
	// Same ~20% (1/5) math as the timeoutMs-provided case above — proves the
	// fallback constant is also 5 minutes, not a flat "always 100%".
	expect(width).toBeGreaterThan(15);
	expect(width).toBeLessThan(25);
});

it("still starts near 100% on a fresh mount (remaining ~= the full fallback window)", () => {
	const fallbackTotalMs = 5 * 60_000; // mirrors bridge-cli's APPROVAL_TIMEOUT_MS
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		timeoutAt: Date.now() + fallbackTotalMs - 1000,
	});
	const fill = view.container.querySelector(
		'[data-slot="approval-countdown-fill"]'
	);
	const width = Number.parseFloat((fill as HTMLElement).style.width);
	expect(width).toBeGreaterThan(90);
	expect(width).toBeLessThanOrEqual(100);
});

it("hides the countdown once the card is answered", () => {
	const { container } = render(
		<ApprovalLine
			answeredOptionId="accept"
			event={{
				...BASE_APPROVAL_EVENT,
				timeoutAt: Date.now() + FUTURE_TIMEOUT_OFFSET_MS,
			}}
		/>
	);
	expect(
		container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
});

// R3-T2: codex offers a third "acceptForSession" option — the button layout
// must render every option event.options carries, not just the first two.
it("renders one button per option, including a third option", () => {
	const view = renderApproval({
		...BASE_APPROVAL_EVENT,
		options: [
			{ id: "accept", label: "Allow" },
			{ id: "acceptForSession", label: "Allow for session" },
			{ id: "decline", label: "Deny" },
		],
	});
	expect(view.getByRole("button", { name: "Allow" })).toBeDefined();
	expect(view.getByRole("button", { name: "Allow for session" })).toBeDefined();
	expect(view.getByRole("button", { name: "Deny" })).toBeDefined();
});
