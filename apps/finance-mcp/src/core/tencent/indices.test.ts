import { describe, expect, it } from "vitest";
import { getIndices, parseIndicesText } from "./indices";

function indexLine(code: string, values: Record<number, string>): string {
	const fields: string[] = new Array(35).fill("");
	for (const [i, v] of Object.entries(values)) {
		fields[Number(i)] = v;
	}
	return `v_${code}="${fields.join("~")}";`;
}

const SH = indexLine("sh000001", {
	1: "上证综指",
	3: "3350.31",
	4: "3325.61",
	32: "0.75",
	33: "3360.00",
	34: "3320.00",
});
const US = indexLine("usDJI", {
	1: "道琼斯",
	3: "44000.12",
	4: "43800.55",
	32: "0.45",
	34: "43750.00",
	33: "44100.00",
});
const FIXTURE = `${SH}\n${US}`;

const CN_CODES = [{ region: "cn" as const, code: "sh000001" }];
const ALL_CODES = [
	{ region: "cn" as const, code: "sh000001" },
	{ region: "us" as const, code: "usDJI" },
];

describe("parseIndicesText", () => {
	it("parses multiple v_<code> lines with region metadata", () => {
		const rows = parseIndicesText(FIXTURE, ALL_CODES);
		expect(rows).toHaveLength(2);
		const sh = rows.find((r) => r.code === "sh000001");
		expect(sh?.region).toBe("cn");
		expect(sh?.name).toBe("上证综指");
		expect(sh?.last).toBe(3350.31);
		expect(sh?.prevClose).toBe(3325.61);
		expect(sh?.changePct).toBe(0.75);
		expect(sh?.high).toBe(3360.0);
		expect(sh?.low).toBe(3320.0);
		const us = rows.find((r) => r.code === "usDJI");
		expect(us?.region).toBe("us");
		expect(us?.name).toBe("道琼斯");
	});

	it("only returns rows matching the supplied code list (region filter)", () => {
		const rows = parseIndicesText(FIXTURE, CN_CODES);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.code).toBe("sh000001");
	});
});

describe("getIndices", () => {
	it("fetches and decodes, filtering to the requested region", async () => {
		// NOTE: fetchImpl stubs with UTF-8 bytes (TextEncoder), but getIndices
		// decodes with TextDecoder("gbk"). That garbles multibyte (Chinese)
		// characters while leaving ASCII numeric fields intact — so this test
		// only asserts numeric fields, not `name`.
		const fetchImpl = async () =>
			new Response(new TextEncoder().encode(FIXTURE));
		const rows = await getIndices("cn", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.last).toBe(3350.31);
		expect(rows[0]?.changePct).toBe(0.75);
	});

	it("degrades to [] on HTTP failure", async () => {
		const fetchImpl = async () => new Response("", { status: 500 });
		const rows = await getIndices("all", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});
