// V7 batch: types for the 3 market-events tools (大宗交易/高管增减持/停复牌).
// New file — types.ts / types-extra.ts / types-data.ts are all at/near the
// project's 300-line-per-file cap. Same pattern as types-data.ts splitting
// off types-extra.ts.

// 大宗交易 (block trade): off-exchange negotiated block, with premium/discount
// vs. the closing price and the buyer/seller broker-branch seats.
export interface BlockTradeRow {
	buyer: string;
	code: string;
	dealAmount: number | null;
	dealPrice: number | null;
	dealVolume: number | null;
	name: string;
	premiumPct: number | null;
	seller: string;
	tradeDate: string;
}

// 高管/股东增减持 (insider buy/sell): executive/related-party holding change —
// who, role, shares/price/amount/ratio moved, and the stated reason.
export interface InsiderRow {
	avgPrice: number | null;
	changeAmount: number | null;
	changeDate: string;
	changeRatio: number | null;
	changeShares: number | null;
	code: string;
	holdType: string;
	name: string;
	person: string;
	position: string;
	reason: string;
	relatedExec: string;
}

// 停复牌 (trading halt/resume): suspension window, reason, and the
// predicted resume date (if disclosed).
export interface SuspensionRow {
	code: string;
	expire: string | null;
	name: string;
	predictResume: string | null;
	reason: string | null;
	suspendEnd: string | null;
	suspendStart: string;
}
