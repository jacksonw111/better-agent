export type Market = "a" | "hk" | "us";

export interface DepthLevel {
	price: number;
	volume: number;
}

export interface Quote {
	asks: DepthLevel[];
	bids: DepthLevel[];
	changePct: number;
	high: number;
	last: number;
	low: number;
	market: Market;
	name: string;
	open: number;
	prevClose: number;
	symbol: string;
	time: string;
	volume: number;
}

export interface Candle {
	close: number;
	high: number;
	low: number;
	open: number;
	time: string;
	volume: number;
}

export type ReportType = "annual" | "h1" | "q1" | "q3";

export interface Report {
	artCode: string;
	fiscalPeriod: string;
	noticeDate: string;
	pdfUrl: string;
	reportType: ReportType;
	title: string;
}

export interface EarningsEvent {
	date: string;
	isPublished?: boolean;
	market: Market;
	name: string;
	reportType?: string;
	session?: string;
	symbol: string;
}

export interface EconomicEvent {
	actual?: string;
	country: string;
	date: string;
	estimate?: string;
	event: string;
	impact?: string;
	prior?: string;
	time?: string;
}

export interface CbOp {
	amount?: number;
	date: string;
	rate?: number;
	tenor?: string;
	type: string;
}

export interface KeyMetrics {
	changePct: number | null;
	close: number | null;
	floatMarketCap: number | null;
	floatShares: number | null;
	marketCap: number | null;
	pb: number | null;
	pcf: number | null;
	peg: number | null;
	peStatic: number | null;
	peTtm: number | null;
	ps: number | null;
	symbol: string;
	totalShares: number | null;
	tradeDate: string | null;
}

export interface CompanyProfile {
	address: string | null;
	businessScope: string | null;
	chairman: string | null;
	csrcIndustry: string | null;
	employees: number | null;
	foundDate: string | null;
	industry: string | null;
	listingDate: string | null;
	market: string | null;
	name: string | null;
	profile: string | null;
	regCapital: number | null;
}

export type StatementType = "income" | "balance" | "cashflow";

export interface StatementRow {
	reportDate: string;
	[key: string]: number | string | null;
}

export interface IndicatorRow {
	bps: number | null;
	debtRatio: number | null;
	eps: number | null;
	grossMargin: number | null;
	netMargin: number | null;
	netProfit: number | null;
	netProfitYoy: number | null;
	opCashPerShare: number | null;
	reportDate: string;
	reportName: string | null;
	revenue: number | null;
	revenueYoy: number | null;
	roe: number | null;
	roeDeducted: number | null;
}

export interface StockHit {
	code: string;
	exchange: "SH" | "SZ" | "BJ";
	market: "a_share";
	name: string;
}

export interface ResearchReport {
	date: string;
	epsY0: number | null;
	epsY1: number | null;
	epsY2: number | null;
	org: string;
	pdfUrl: string;
	peY0: number | null;
	peY1: number | null;
	peY2: number | null;
	title: string;
}

export interface ForecastRow {
	eps: number | null;
	pe: number | null;
	revenue?: number | null;
	year: string;
}

export interface IndexQuote {
	changePct: number;
	code: string;
	high: number;
	last: number;
	low: number;
	name: string;
	prevClose: number;
	region: "cn" | "hk" | "us";
}

export interface CommodityQuote {
	changePct: number;
	high: number;
	key: string;
	last: number;
	low: number;
	name: string;
	prevClose: number;
	time: string;
}
