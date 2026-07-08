import { describe, expect, it } from "vitest";
import { pbocOps } from "./central-bank";

describe("pbocOps", () => {
	it("normalizes reverse-repo rows", async () => {
		const payload = {
			result: {
				data: [
					{
						TRADE_DATE: "2026-07-08 00:00:00",
						SECURITY_NAME_ABBR: "7天逆回购",
						VALUE: 1500,
						INTEREST_RATE: 1.4,
						TERM: "7天",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const ops = await pbocOps({ fetchImpl: fetchImpl as typeof fetch });
		expect(ops[0]).toMatchObject({
			date: "2026-07-08",
			type: "7天逆回购",
			amount: 1500,
			rate: 1.4,
			tenor: "7天",
		});
	});

	it("returns [] on empty", async () => {
		const fetchImpl = () =>
			Promise.resolve(Response.json({ result: { data: [] } }));
		expect(await pbocOps({ fetchImpl: fetchImpl as typeof fetch })).toEqual([]);
	});
});
