// V3 batch: types for the free A-share tools (dividends, dragon-tiger, top
// holders). Split out of types.ts (which is at the project's
// 300-line-per-file cap) — same pattern as tool-defs-market.ts /
// tools-impl-market.ts splitting out of their base files.

export interface DividendRow {
	bonusRatioDividend: number | null;
	bonusRatioTransfer: number | null;
	exDividendDate: string;
	noticeDate: string;
	plan: string;
	pretaxDividendRmb: number | null;
	progress: string;
	recordDate: string;
	reportDate: string;
}

export interface DragonTigerRow {
	billboardAmount: number | null;
	changePct: number | null;
	close: number | null;
	code: string;
	name: string;
	reason: string;
	tradeDate: string;
	turnoverRate: number | null;
}

export interface HolderRow {
	changeRatio: number | null;
	changeShares: number | null;
	endDate: string;
	freeFloatRatio: number | null;
	holder: string;
	isInstitution: boolean;
	rank: number | null;
	shares: number | null;
}
