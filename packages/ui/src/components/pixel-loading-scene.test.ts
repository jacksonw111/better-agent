import { expect, it } from "vitest";
import { jumpLift } from "./pixel-loading-scene";
import {
	RUNNER_HEIGHT,
	RUNNER_JUMP,
	RUNNER_RUN_1,
	RUNNER_RUN_2,
	SPRITE_COLORS,
} from "./pixel-loading-sprites";

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

const SPRITE_WIDTH = 12;

it("keeps every runner frame on a rectangular 12-wide grid of known colors", () => {
	for (const sprite of [RUNNER_RUN_1, RUNNER_RUN_2, RUNNER_JUMP]) {
		expect(sprite).toHaveLength(RUNNER_HEIGHT);
		for (const row of sprite) {
			expect(row).toHaveLength(SPRITE_WIDTH);
			for (const cell of row) {
				expect(cell === "." || cell in SPRITE_COLORS).toBe(true);
			}
		}
	}
});
