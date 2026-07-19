import { expect, it } from "vitest";
import { jumpLift } from "./pixel-loading-scene";

// First pipe sits at x=352 (see PIPES); the level loops every 1536px.
const PIPE_CENTER = 361;
const FLAT_GROUND = 100;
const LEVEL_LEN = 1536;
const FIRST_PIPE_HEIGHT = 16;

it("stays grounded on flat stretches", () => {
	expect(jumpLift(FLAT_GROUND)).toBe(0);
});

it("clears the first pipe at its center", () => {
	expect(jumpLift(PIPE_CENTER)).toBeGreaterThan(FIRST_PIPE_HEIGHT);
});

it("loops: the same spot one level later jumps identically", () => {
	expect(jumpLift(PIPE_CENTER + LEVEL_LEN)).toBeCloseTo(
		jumpLift(PIPE_CENTER),
		6
	);
});
