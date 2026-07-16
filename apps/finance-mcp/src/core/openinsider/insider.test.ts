import { describe, expect, it } from "vitest";
import { getUsInsider, parseInsiderHtml } from "./insider";

// A minimal tinytable with the 16 OpenInsider columns; only the ones the
// parser reads need realistic values.
function tableRow(cells: string[]): string {
	return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

const HEADER = tableRow(
	Array.from({ length: 16 }, (_, i) => `<th>h${i}</th>`)
).replace(/td/g, "th");

const BUY = tableRow([
	"P",
	"2026-06-17 18:30:15",
	"2026-06-16",
	"AAPL",
	"Cook Tim",
	"CEO",
	"P - Purchase",
	"$295.14",
	"1,000",
	"38,713",
	"+3%",
	"$295,140",
	"",
	"",
	"",
	"",
]);
const SELL = tableRow([
	"S",
	"2026-05-10 16:00:00",
	"2026-05-09",
	"AAPL",
	"Borders Ben",
	"Principal Accounting Officer",
	"S - Sale+OE",
	"$280.00",
	"-116",
	"38,713",
	"-1%",
	"-$32,480",
	"",
	"",
	"",
	"",
]);

const HTML = `<html><table class="tinytable">${HEADER}${BUY}${SELL}</table></html>`;

describe("parseInsiderHtml", () => {
	it("parses trade type/side, signed qty & value, and dates", () => {
		const rows = parseInsiderHtml(HTML, 25);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			filingDate: "2026-06-17",
			tradeDate: "2026-06-16",
			insider: "Cook Tim",
			title: "CEO",
			side: "buy",
			price: 295.14,
			qty: 1000,
			value: 295_140,
			deltaOwn: "+3%",
		});
		expect(rows[1]).toMatchObject({ side: "sell", qty: -116, value: -32_480 });
	});

	it("respects the limit and returns [] without the table", () => {
		expect(parseInsiderHtml(HTML, 1)).toHaveLength(1);
		expect(parseInsiderHtml("<html>no table</html>", 25)).toEqual([]);
	});
});

describe("getUsInsider", () => {
	it("upper-cases the ticker into the screener query and clamps the limit", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request) => {
			seen = String(url);
			return Promise.resolve(new Response(HTML));
		}) as typeof fetch;
		const rows = await getUsInsider("aapl", 999, 730, { fetchImpl });
		const parsed = new URL(seen);
		expect(parsed.searchParams.get("s")).toBe("AAPL");
		expect(parsed.searchParams.get("fd")).toBe("730");
		expect(parsed.searchParams.get("nrows")).toBe("100"); // clamped to MAX
		expect(rows).toHaveLength(2);
	});

	it("degrades to [] on HTTP 500", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getUsInsider("AAPL", 25, 365, { fetchImpl })).toEqual([]);
	});
});
