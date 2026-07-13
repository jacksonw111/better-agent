// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ControlStrip } from "./control-strip";

it("renders nothing when both slots are empty (a read-only card has no strip)", () => {
	const { container } = render(<ControlStrip />);
	expect(container.firstChild).toBeNull();
});

it("renders both the primary control and the chips group when given", () => {
	const { container } = render(
		<ControlStrip
			chips={<span>chip-group</span>}
			primary={<span>primary-control</span>}
		/>
	);
	const scope = within(container);
	expect(scope.getByText("primary-control")).toBeDefined();
	expect(scope.getByText("chip-group")).toBeDefined();
});

it("renders only the chips group when primary is omitted", () => {
	const { container } = render(<ControlStrip chips={<span>chip-only</span>} />);
	expect(within(container).getByText("chip-only")).toBeDefined();
	expect(container.firstChild).not.toBeNull();
});
