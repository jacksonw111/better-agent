import { describe, expect, it } from "vitest";
import { createSemaphore } from "./tool-concurrency";

describe("createSemaphore", () => {
	it("never runs more than `limit` tasks at once", async () => {
		const sem = createSemaphore(2);
		let active = 0;
		let peak = 0;
		const task = () =>
			sem.run(async () => {
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((r) => setTimeout(r, 5));
				active -= 1;
				return active;
			});
		await Promise.all(Array.from({ length: 8 }, task));
		expect(peak).toBeLessThanOrEqual(2);
		expect(peak).toBeGreaterThan(0);
	});

	it("runs every queued task and returns its value", async () => {
		const sem = createSemaphore(2);
		const results = await Promise.all(
			[1, 2, 3, 4, 5].map((n) => sem.run(() => Promise.resolve(n * 10)))
		);
		expect(results).toEqual([10, 20, 30, 40, 50]);
	});

	it("releases the slot when a task rejects (no deadlock)", async () => {
		const sem = createSemaphore(1);
		await expect(
			sem.run(() => Promise.reject(new Error("boom")))
		).rejects.toThrow("boom");
		// The next task must still get the (released) slot.
		await expect(sem.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
	});
});
