// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	renderHook,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BridgeSessionRow } from "@/utils/api-types";
import {
	LocalAgentSessionPicker,
	sortSessionsByRecency,
	useSessionSelection,
} from "./local-agent-session-picker";

const BASE_MS = new Date("2026-07-04T12:00:00Z").getTime();
const MINUTE_MS = 60_000;

function makeSession(overrides: Partial<BridgeSessionRow>): BridgeSessionRow {
	return {
		id: "session-x",
		userId: "user-1",
		tokenId: "token-1",
		agentKind: "claude-code",
		label: null,
		agentSessionId: null,
		status: "active",
		createdAt: new Date(BASE_MS),
		lastSeenAt: new Date(BASE_MS),
		vncEndpoint: null,
		attention: null,
		...overrides,
	};
}

// Newest first, as the picker expects.
const NEWER = makeSession({
	id: "session-new",
	label: "gamma",
	createdAt: new Date(BASE_MS + MINUTE_MS),
	lastSeenAt: new Date(BASE_MS + MINUTE_MS),
});
const OLDER = makeSession({
	id: "session-old",
	label: "beta",
	status: "ended",
	createdAt: new Date(BASE_MS - MINUTE_MS),
	lastSeenAt: new Date(BASE_MS - MINUTE_MS),
});

afterEach(() => cleanup());

it("sorts sessions newest first", () => {
	const sorted = sortSessionsByRecency([OLDER, NEWER]);
	expect(sorted.map((session) => session.id)).toEqual([
		"session-new",
		"session-old",
	]);
});

it("defaults selection to the most recent session", () => {
	const { result } = renderHook(() => useSessionSelection([NEWER, OLDER]));
	expect(result.current.activeSession?.id).toBe("session-new");
});

function SelectionHarness() {
	const { activeSession, select } = useSessionSelection([NEWER, OLDER]);
	return (
		<LocalAgentSessionPicker
			activeId={activeSession?.id ?? null}
			now={new Date(BASE_MS)}
			onSelect={select}
			sessions={[NEWER, OLDER]}
		/>
	);
}

it("switches the shown session when the user picks another", () => {
	const { container } = render(<SelectionHarness />);
	const scope = within(container.ownerDocument.body);

	// Defaults to the most recent (gamma).
	expect(scope.getByText("gamma")).toBeDefined();

	fireEvent.click(scope.getByRole("button"));
	fireEvent.click(scope.getByText("beta"));

	// The trigger now reflects the picked (older) session.
	expect(scope.getByRole("button").textContent).toContain("beta");
});

it("lists sessions and reports the one the user selects", () => {
	const onSelect = vi.fn();
	const { container } = render(
		<LocalAgentSessionPicker
			activeId="session-new"
			now={new Date(BASE_MS)}
			onSelect={onSelect}
			sessions={[NEWER, OLDER]}
		/>
	);
	const scope = within(container.ownerDocument.body);
	// Trigger shows the active (most recent) session.
	expect(scope.getByText("gamma")).toBeDefined();

	fireEvent.click(scope.getByRole("button"));
	fireEvent.click(scope.getByText("beta"));
	expect(onSelect).toHaveBeenCalledWith("session-old");
});
