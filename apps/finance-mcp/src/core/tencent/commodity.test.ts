import { describe, expect, it } from "vitest";
import { getCommodities, parseCommodityText } from "./commodity";

const GOLD = `v_hf_GC="4045.41,-2.69,4046.70,4047.20,4144.70,4032.50,00:04:02,4157.4,~";`;
const OIL = `v_hf_CL="68.12,0.34,68.00,68.10,68.90,67.50,00:04:02,67.88,~";`;
const FIXTURE = `${GOLD}\n${OIL}`;

describe("parseCommodityText", () => {
	it("parses hf_ international-futures field layout", () => {
		const rows = parseCommodityText(FIXTURE);
		expect(rows).toHaveLength(2);
		const gold = rows.find((r) => r.key === "gold");
		expect(gold?.name).toBe("COMEX黄金");
		expect(gold?.last).toBe(4045.41);
		expect(gold?.changePct).toBe(-2.69);
		expect(gold?.high).toBe(4144.7);
		expect(gold?.low).toBe(4032.5);
		expect(gold?.time).toBe("00:04:02");
		expect(gold?.prevClose).toBe(4157.4);
		const oil = rows.find((r) => r.key === "oil");
		expect(oil?.name).toBe("WTI原油");
		expect(oil?.last).toBe(68.12);
	});

	it("ignores unrequested codes", () => {
		const rows = parseCommodityText(GOLD);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.key).toBe("gold");
	});
});

describe("getCommodities", () => {
	it("fetches and decodes, asserting numeric fields", async () => {
		// NOTE: fetchImpl stubs with UTF-8 bytes (TextEncoder), but getCommodities
		// decodes with TextDecoder("gbk"). That garbles multibyte (Chinese)
		// characters while leaving ASCII numeric fields intact — so this test
		// only asserts numeric fields, not `name`.
		const fetchImpl = async () =>
			new Response(new TextEncoder().encode(FIXTURE));
		const rows = await getCommodities({ fetchImpl: fetchImpl as typeof fetch });
		expect(rows).toHaveLength(2);
		const gold = rows.find((r) => r.key === "gold");
		expect(gold?.last).toBe(4045.41);
		expect(gold?.high).toBe(4144.7);
		expect(gold?.low).toBe(4032.5);
		expect(gold?.prevClose).toBe(4157.4);
	});

	it("degrades to [] on HTTP failure", async () => {
		const fetchImpl = async () => new Response("", { status: 500 });
		const rows = await getCommodities({
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});
