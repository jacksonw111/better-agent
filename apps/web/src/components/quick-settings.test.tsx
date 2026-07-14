// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { getClientPref } from "@/utils/preferences";
import { QuickSettings } from "./quick-settings";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	document.documentElement.classList.remove("dark");
});

/** Renders the control and opens the popover; rows portal into document.body. */
async function openPanel() {
	const { container } = render(<QuickSettings />);
	fireEvent.click(
		within(container).getByRole("button", { name: "Quick settings" })
	);
	const body = within(document.body);
	await waitFor(() => {
		expect(body.getByRole("switch", { name: "Show thinking" })).toBeDefined();
	});
	return body;
}

it("shows all four rows with the pref defaults reflected", async () => {
	const body = await openPanel();
	expect(
		body
			.getByRole("switch", { name: "Show thinking" })
			.getAttribute("aria-checked")
	).toBe("true");
	expect(
		body
			.getByRole("switch", { name: "Show raw parameters" })
			.getAttribute("aria-checked")
	).toBe("false");
	expect(
		body
			.getByRole("switch", { name: "Send with ⌃↵" })
			.getAttribute("aria-checked")
	).toBe("false");
	expect(
		body
			.getByRole("switch", { name: "Dark theme" })
			.getAttribute("aria-checked")
	).toBe("false");
});

it("toggling a pref row flips and persists the pref", async () => {
	const body = await openPanel();

	fireEvent.click(body.getByRole("switch", { name: "Show thinking" }));
	expect(getClientPref("showThinking")).toBe(false);

	fireEvent.click(body.getByRole("switch", { name: "Show raw parameters" }));
	expect(getClientPref("showRawParameters")).toBe(true);

	fireEvent.click(body.getByRole("switch", { name: "Send with ⌃↵" }));
	expect(getClientPref("sendByCtrlEnter")).toBe(true);
});

it("the theme row calls the existing toggle and reflects the new theme", async () => {
	const body = await openPanel();
	const themeSwitch = body.getByRole("switch", { name: "Dark theme" });

	fireEvent.click(themeSwitch);
	expect(document.documentElement.classList.contains("dark")).toBe(true);
	expect(window.localStorage.getItem("theme")).toBe("dark");
	await waitFor(() => {
		expect(themeSwitch.getAttribute("aria-checked")).toBe("true");
	});

	fireEvent.click(themeSwitch);
	expect(document.documentElement.classList.contains("dark")).toBe(false);
	expect(window.localStorage.getItem("theme")).toBe("light");
});
