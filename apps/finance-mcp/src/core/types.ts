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
