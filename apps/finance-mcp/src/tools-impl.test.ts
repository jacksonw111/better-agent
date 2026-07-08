import { describe, expect, it } from "vitest";
import { runTool } from "./tools-impl";

describe("runTool dispatch table", () => {
	it("routes an existing tool (finance_quote) through its handler", async () => {
		const SH =
			'v_sh600000="1~浦发银行~600000~9.00~8.89~8.85~544687~323481~221557~9.00~1384~8.99~2223~8.98~911~8.97~602~8.96~374~9.01~655~9.02~17648~9.03~10161~9.04~6039~9.05~10338~~20260708161454~0.11~1.24~9.03~8.79~~";';
		const orig = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new TextEncoder().encode(SH))) as typeof fetch;
		try {
			const result = await runTool("finance_quote", { symbol: "600000.SH" });
			expect(result.isError).toBe(false);
			const body = JSON.parse(result.content[0]?.text ?? "{}") as {
				symbol: string;
			};
			expect(body.symbol).toBe("600000.SH");
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("returns isError for an unknown tool", async () => {
		const result = await runTool("finance_nope", {});
		expect(result.isError).toBe(true);
	});
});
