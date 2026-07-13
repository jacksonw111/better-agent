// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Chip } from "./chip";

vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

it("onToggle fires when an enabled chip is clicked", () => {
	const onToggle = vi.fn();
	const { container } = render(
		<Chip active={false} label="营收" onToggle={onToggle} />
	);
	fireEvent.click(within(container).getByText("营收"));
	expect(onToggle).toHaveBeenCalledTimes(1);
});

it("active vs inactive chips carry distinct fill classes", () => {
	const { container, rerender } = render(
		<Chip active={true} label="净利润" onToggle={vi.fn()} />
	);
	const button = within(container)
		.getByText("净利润")
		.closest("button") as HTMLButtonElement;
	expect(button.className).toContain("bg-primary");
	expect(button.getAttribute("aria-pressed")).toBe("true");

	rerender(<Chip active={false} label="净利润" onToggle={vi.fn()} />);
	expect(button.className).not.toContain("bg-primary");
	expect(button.className).toContain("bg-muted/40");
	expect(button.getAttribute("aria-pressed")).toBe("false");
});

it("a disabled chip is non-interactive and never fires onToggle", () => {
	const onToggle = vi.fn();
	const { container } = render(
		<Chip active={false} disabled label="毛利率" onToggle={onToggle} />
	);
	const button = within(container)
		.getByText("毛利率")
		.closest("button") as HTMLButtonElement;
	expect(button.disabled).toBe(true);
	fireEvent.click(button);
	expect(onToggle).not.toHaveBeenCalled();
});

it("a tone color tints the active state instead of the default accent fill", () => {
	const tone = "#3b82f6";
	const { container } = render(
		<Chip active={true} label="MA5" onToggle={vi.fn()} tone={tone} />
	);
	const button = within(container)
		.getByText("MA5")
		.closest("button") as HTMLButtonElement;
	expect(button.className).not.toContain("bg-primary");
	expect(button.style.color).toBe("rgb(59, 130, 246)");
});
