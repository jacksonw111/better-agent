// V6a batch: types for the 4 event-data tools (业绩预告/限售解禁/可转债/新股IPO).
// New file — types.ts / types-extra.ts are both at (or near) the project's
// 300-line-per-file cap. Same pattern as types-extra.ts splitting off types.ts.

// 业绩预告 (earnings pre-announcement): 预增/预减/首亏/扭亏 etc, with the
// year-over-year change range and management's stated reason.
export interface PreannounceRow {
	changeLower: number | null;
	changeUpper: number | null;
	code: string;
	content: string;
	name: string;
	noticeDate: string;
	reason: string;
	reportDate: string;
	type: string;
}

// 限售解禁 (lockup expiry): shares coming off restriction, with the total
// float ratio and market value being unlocked.
export interface LockupRow {
	code: string;
	freeDate: string;
	freeRatio: number | null;
	freeShares: number | null;
	liftMarketCap: number | null;
	name: string;
	type: string;
}

// 可转债 (convertible bond) listing: bond + underlying-stock identity, credit
// rating, listing/expiry window, issue size/price.
export interface ConvertibleBondRow {
	code: string;
	expireDate: string;
	issuePrice: number | null;
	issueScale: number | null;
	listingDate: string;
	name: string;
	rating: string;
	stockCode: string;
}

// 新股IPO (IPO calendar / 申购): application code/date, listing date, board,
// issue price, application cap, and issue/industry P/E for pricing context.
export interface IpoRow {
	afterPe: number | null;
	applyCode: string;
	applyDate: string;
	applyUpper: number | null;
	code: string;
	industryPe: number | null;
	issuePrice: number | null;
	listingDate: string;
	market: string;
	name: string;
}

// V6b batch: index weights / ETF list / option chain.

// 指数成分权重 (index constituent weights): 成分股 + 权重% + 行业/PE/ROE for
// one of the tracked benchmark indices (沪深300/上证50/科创50).
export interface IndexWeightRow {
	changePct: number | null;
	closePrice: number | null;
	code: string;
	industry: string;
	name: string;
	pe: number | null;
	roe: number | null;
	weight: number | null;
}

// ETF列表 (ETF list): 代码/名称/最新价/涨跌幅/成交量/换手率, ranked by change%.
export interface EtfRow {
	changePct: number;
	code: string;
	name: string;
	price: number;
	turnover: number;
	turnoverRate: number;
	volume: number;
}

// 期权链 (ETF option chain): 合约/认购认沽/行权价/最新价/涨跌幅/成交量 for one
// of the 50/300/500 ETF option underlyings.
export interface OptionRow {
	changePct: number;
	code: string;
	kind: "call" | "put";
	last: number;
	name: string;
	strike: number | null;
	volume: number;
}
