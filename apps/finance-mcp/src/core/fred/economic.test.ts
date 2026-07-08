import { describe, expect, it, vi } from "vitest";
import { economicCalendar, NotConfiguredError } from "./economic";

const FROM = "2026-07-01";
const TO = "2026-07-31";

const NORMALIZE_PAYLOAD = {
	release_dates: [
		{
			release_id: 10,
			release_name: "Consumer Price Index",
			date: "2026-07-15",
		},
		{
			release_id: 46,
			release_name: "Producer Price Index",
			date: "2026-07-16",
		},
	],
};

const FILTER_PAYLOAD = {
	release_dates: [
		{
			release_id: 10,
			release_name: "Consumer Price Index",
			date: "2026-06-30",
		},
		{
			release_id: 46,
			release_name: "Producer Price Index",
			date: "2026-07-16",
		},
		{
			release_id: 50,
			release_name: "Employment Situation",
			date: "2026-08-01",
		},
	],
};

describe("economicCalendar: config + normalization", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(
			economicCalendar("2026-07-01", "2026-07-15", "", undefined)
		).rejects.toBeInstanceOf(NotConfiguredError);
	});

	it("normalizes FRED release-dates rows", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(NORMALIZE_PAYLOAD));
		const events = await economicCalendar(FROM, TO, "KEY", undefined, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			country: "US",
			event: "Consumer Price Index",
			date: "2026-07-15",
		});
		expect(events[1]).toMatchObject({
			country: "US",
			event: "Producer Price Index",
			date: "2026-07-16",
		});
	});
});

describe("economicCalendar: filtering", () => {
	it("filters out rows outside [from, to]", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(FILTER_PAYLOAD));
		const events = await economicCalendar(FROM, TO, "KEY", undefined, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event: "Producer Price Index",
			date: "2026-07-16",
		});
	});

	it("returns [] for a non-US country without calling fetch", async () => {
		const fetchImpl = vi.fn(() =>
			Promise.resolve(Response.json({ release_dates: [] }))
		);
		const events = await economicCalendar(FROM, TO, "KEY", "CN", {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(events).toEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

const NOISE_PAYLOAD = {
	release_dates: [
		{
			release_id: 100,
			release_name: "Coinbase Cryptocurrencies",
			date: "2026-07-10",
		},
		{
			release_id: 10,
			release_name: "Consumer Price Index",
			date: "2026-07-15",
		},
	],
};

describe("economicCalendar: curated allowlist", () => {
	it("default filter drops noise releases not on the curated allowlist", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(NOISE_PAYLOAD));
		const events = await economicCalendar(FROM, TO, "KEY", undefined, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ event: "Consumer Price Index" });
	});

	it("all: true returns every release, bypassing the curated allowlist", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(NOISE_PAYLOAD));
		const events = await economicCalendar(FROM, TO, "KEY", undefined, {
			all: true,
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toHaveLength(2);
	});

	it("event filter matches by case-insensitive substring, bypassing the curated allowlist", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(NOISE_PAYLOAD));
		const events = await economicCalendar(FROM, TO, "KEY", undefined, {
			event: "coinbase",
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ event: "Coinbase Cryptocurrencies" });
	});
});
