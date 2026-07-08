import type { Market } from "./types";

export class BadSymbolError extends Error {}

const SUFFIX_RE = /\.(SH|SZ|HK|US)$/i;
const SH_A_PREFIX = /^(5|6|9)/; // Shanghai A-share / STAR code ranges
const ALL_DIGITS = /^\d+$/;
const HK_CODE_WIDTH = 5;
const CHINESE_A_SHARE_LENGTH = 6;

function handleSuffixCase(
	suffix: string,
	body: string
): {
	market: Market;
	code: string;
	tencent: string;
} | null {
	if (suffix === "SH") {
		return { market: "a", code: body, tencent: `sh${body}` };
	}
	if (suffix === "SZ") {
		return { market: "a", code: body, tencent: `sz${body}` };
	}
	if (suffix === "HK") {
		const code = body.padStart(HK_CODE_WIDTH, "0");
		return { market: "hk", code, tencent: `hk${code}` };
	}
	if (suffix === "US") {
		const code = body.toUpperCase();
		return { market: "us", code, tencent: `us${code}` };
	}
	return null;
}

function inferFromShape(body: string): {
	market: Market;
	code: string;
	tencent: string;
} {
	if (ALL_DIGITS.test(body)) {
		if (body.length === CHINESE_A_SHARE_LENGTH) {
			const t = SH_A_PREFIX.test(body) ? `sh${body}` : `sz${body}`;
			return { market: "a", code: body, tencent: t };
		}
		const code = body.padStart(HK_CODE_WIDTH, "0");
		return { market: "hk", code, tencent: `hk${code}` };
	}
	const code = body.toUpperCase();
	return { market: "us", code, tencent: `us${code}` };
}

export function parseSymbol(input: string): {
	market: Market;
	code: string;
	tencent: string;
} {
	const raw = input.trim();
	if (!raw) {
		throw new BadSymbolError("empty symbol");
	}
	const suffixMatch = raw.match(SUFFIX_RE);
	const suffix = suffixMatch?.[1]?.toUpperCase();
	const body = raw.replace(SUFFIX_RE, "");

	if (suffix) {
		const result = handleSuffixCase(suffix, body);
		if (result) {
			return result;
		}
	}

	return inferFromShape(body);
}
