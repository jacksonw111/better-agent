// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { getClientPref, setClientPref, useClientPref } from "./preferences";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
});

it("returns the built-in defaults when nothing is persisted", () => {
	expect(getClientPref("showThinking")).toBe(true);
	expect(getClientPref("showRawParameters")).toBe(false);
	expect(getClientPref("sendByCtrlEnter")).toBe(false);
});

it("persists a set value under the ba:pref: key and reads it back", () => {
	setClientPref("showThinking", false);
	expect(window.localStorage.getItem("ba:pref:showThinking")).toBe("false");
	expect(getClientPref("showThinking")).toBe(false);

	setClientPref("sendByCtrlEnter", true);
	expect(window.localStorage.getItem("ba:pref:sendByCtrlEnter")).toBe("true");
	expect(getClientPref("sendByCtrlEnter")).toBe(true);
});

it("falls back to the default for a corrupt persisted value", () => {
	window.localStorage.setItem("ba:pref:showThinking", "banana");
	expect(getClientPref("showThinking")).toBe(true);

	window.localStorage.setItem("ba:pref:sendByCtrlEnter", "1");
	expect(getClientPref("sendByCtrlEnter")).toBe(false);
});

it("useClientPref re-renders when the pref is set from anywhere", () => {
	const { result } = renderHook(() => useClientPref("showRawParameters"));
	expect(result.current).toBe(false);

	act(() => {
		setClientPref("showRawParameters", true);
	});
	expect(result.current).toBe(true);

	act(() => {
		setClientPref("showRawParameters", false);
	});
	expect(result.current).toBe(false);
});

it("picks up another tab's change via the storage event", () => {
	const { result } = renderHook(() => useClientPref("showThinking"));
	expect(result.current).toBe(true);

	window.localStorage.setItem("ba:pref:showThinking", "false");
	act(() => {
		window.dispatchEvent(
			new StorageEvent("storage", { key: "ba:pref:showThinking" })
		);
	});
	expect(result.current).toBe(false);
});
