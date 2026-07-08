import { describe, expect, it } from "vitest";
import { fedOps } from "./nyfed";

describe("fedOps", () => {
	it("normalizes NY Fed repo operations", async () => {
		const payload = {
			repo: {
				operations: [
					{
						operationDate: "2026-07-07",
						operationType: "Reverse Repo",
						totalAmtAccepted: 250_000_000_000,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const ops = await fedOps({ fetchImpl: fetchImpl as typeof fetch });
		expect(ops[0]).toMatchObject({
			date: "2026-07-07",
			type: "Reverse Repo",
			amount: 250_000_000_000,
		});
	});

	it("returns [] on unexpected shape", async () => {
		const fetchImpl = () => Promise.resolve(Response.json({}));
		expect(await fedOps({ fetchImpl: fetchImpl as typeof fetch })).toEqual([]);
	});
});
