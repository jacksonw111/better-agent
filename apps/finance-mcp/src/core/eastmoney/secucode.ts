import { BadSymbolError, parseSymbol } from "../symbol";

export interface Secucode {
	emCode: string;
	secucode: string;
}

// A-share-only helper for the EastMoney datacenter/HSF10 fundamentals APIs,
// which key rows by SECUCODE ("600519.SH") or an EM-prefixed code ("SH600519").
export function secucode(symbol: string): Secucode {
	const { market, code, tencent } = parseSymbol(symbol);
	if (market !== "a") {
		throw new BadSymbolError("fundamentals are A-share only, e.g. 600519.SH");
	}
	const exch = tencent.startsWith("sh") ? "SH" : "SZ";
	return {
		secucode: `${code}.${exch}`,
		emCode: `${exch}${code}`,
	};
}
