import { expect, it } from "vitest";
import { nextPermissionMode } from "./permission-mode-cycle";

const MODES = ["default", "acceptEdits", "plan"] as const;

it("steps forward through the modes, wrapping at the end", () => {
	expect(nextPermissionMode("default", MODES, 1)).toBe("acceptEdits");
	expect(nextPermissionMode("acceptEdits", MODES, 1)).toBe("plan");
	expect(nextPermissionMode("plan", MODES, 1)).toBe("default");
});

it("steps backward through the modes, wrapping at the start", () => {
	expect(nextPermissionMode("default", MODES, -1)).toBe("plan");
	expect(nextPermissionMode("plan", MODES, -1)).toBe("acceptEdits");
});

it("starts from the list's edge for an absent or unknown current mode", () => {
	expect(nextPermissionMode(undefined, MODES, 1)).toBe("default");
	expect(nextPermissionMode(undefined, MODES, -1)).toBe("plan");
	expect(nextPermissionMode("bogus", MODES, 1)).toBe("default");
});

it("has nothing to cycle below two modes", () => {
	expect(nextPermissionMode("default", ["default"], 1)).toBeNull();
	expect(nextPermissionMode(undefined, [], 1)).toBeNull();
});
