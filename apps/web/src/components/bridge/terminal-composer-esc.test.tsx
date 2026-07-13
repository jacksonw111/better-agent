// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TerminalComposer } from "./terminal-composer";

// P1-T5's esc-to-stop keyboard layer — split from terminal-composer.test.tsx
// for the repo's 300-line cap.

it("Esc interrupts an interruptible in-flight turn (P1-T5)", () => {
	const onInterrupt = vi.fn();
	render(
		<TerminalComposer
			canInterrupt
			disabled={false}
			onInterrupt={onInterrupt}
			onSend={vi.fn()}
			sending={false}
			turnInFlight
		/>
	);

	fireEvent.keyDown(document, { key: "Escape" });
	expect(onInterrupt).toHaveBeenCalledTimes(1);
});

it("Esc is inert when no turn is in flight or the press was already handled", () => {
	const onInterrupt = vi.fn();
	const { rerender } = render(
		<TerminalComposer
			canInterrupt
			disabled={false}
			onInterrupt={onInterrupt}
			onSend={vi.fn()}
			sending={false}
			turnInFlight={false}
		/>
	);

	fireEvent.keyDown(document, { key: "Escape" });
	expect(onInterrupt).not.toHaveBeenCalled();

	rerender(
		<TerminalComposer
			canInterrupt
			disabled={false}
			onInterrupt={onInterrupt}
			onSend={vi.fn()}
			sending={false}
			turnInFlight
		/>
	);
	const handled = new KeyboardEvent("keydown", {
		cancelable: true,
		key: "Escape",
	});
	handled.preventDefault();
	document.dispatchEvent(handled);
	expect(onInterrupt).not.toHaveBeenCalled();
});
