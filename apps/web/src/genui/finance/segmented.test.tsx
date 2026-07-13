// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Segmented } from "./segmented";

// `useReducedMotion` mocked true so the sliding indicator / spring pop don't
// need a real animation frame to settle — this test asserts click behavior
// and disabled/selected DOM state, not motion internals (per the task brief).
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const OPTIONS = [
	{ id: "1y", label: "1Y" },
	{ id: "5y", label: "5Y" },
	{ id: "10y", label: "10Y" },
];

it("onChange fires with the clicked option's id", () => {
	const onChange = vi.fn();
	const { container } = render(
		<Segmented onChange={onChange} options={OPTIONS} value="1y" />
	);
	fireEvent.click(within(container).getByText("5Y"));
	expect(onChange).toHaveBeenCalledWith("5y");
});

it("the active option is marked selected", () => {
	const { container } = render(
		<Segmented onChange={vi.fn()} options={OPTIONS} value="5y" />
	);
	const scope = within(container);
	expect(
		scope.getByText("1Y").closest("button")?.getAttribute("aria-pressed")
	).toBe("false");
	expect(
		scope.getByText("5Y").closest("button")?.getAttribute("aria-pressed")
	).toBe("true");
});

it("a disabled id renders non-interactive and never fires onChange", () => {
	const onChange = vi.fn();
	const { container } = render(
		<Segmented
			disabledIds={["10y"]}
			onChange={onChange}
			options={OPTIONS}
			value="1y"
		/>
	);
	const button = within(container)
		.getByText("10Y")
		.closest("button") as HTMLButtonElement;
	expect(button.disabled).toBe(true);
	fireEvent.click(button);
	expect(onChange).not.toHaveBeenCalled();
});
