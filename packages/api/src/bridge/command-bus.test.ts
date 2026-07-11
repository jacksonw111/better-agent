import { describe, expect, it } from "vitest";
import { createCommandBus } from "./command-bus";

const SUBSCRIBER_COUNT = 2;

describe("CommandBus", () => {
	it("notify reaches every subscriber registered for that sessionId", () => {
		const bus = createCommandBus();
		let calls = 0;
		bus.subscribe("s1", () => {
			calls += 1;
		});
		bus.subscribe("s1", () => {
			calls += 1;
		});

		bus.notify("s1");

		expect(calls).toBe(SUBSCRIBER_COUNT);
	});

	it("notify does not reach subscribers of a different sessionId", () => {
		const bus = createCommandBus();
		let otherCalls = 0;
		bus.subscribe("other-session", () => {
			otherCalls += 1;
		});

		bus.notify("s1");

		expect(otherCalls).toBe(0);
	});

	it("unsubscribe stops further notifications to that subscriber", () => {
		const bus = createCommandBus();
		let calls = 0;
		const unsubscribe = bus.subscribe("s1", () => {
			calls += 1;
		});

		bus.notify("s1");
		unsubscribe();
		bus.notify("s1");

		expect(calls).toBe(1);
	});

	it("notify with no subscribers is a silent no-op", () => {
		const bus = createCommandBus();
		expect(() => bus.notify("nobody-here")).not.toThrow();
	});

	it("a throwing subscriber does not stop other subscribers from being notified", () => {
		const bus = createCommandBus();
		let secondCalled = false;
		bus.subscribe("s1", () => {
			throw new Error("boom");
		});
		bus.subscribe("s1", () => {
			secondCalled = true;
		});

		expect(() => bus.notify("s1")).not.toThrow();
		expect(secondCalled).toBe(true);
	});
});
