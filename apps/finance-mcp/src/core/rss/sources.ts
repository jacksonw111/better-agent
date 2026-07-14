// Curated tier-1 industry RSS sources — 4 well-known, reliable pure-RSS
// outlets per industry key. Hand-picked from the research source list;
// aggregator proxies (wechat2rss, hnrss) and paywalled-only feeds skipped.

export interface RssSource {
	name: string;
	url: string;
}

export const INDUSTRY_NAMES: Record<string, string> = {
	ai: "AI / 大模型",
	auto: "汽车 / 新能源车",
	bio: "生物医药 / 健康",
	consumer: "消费电子 / 数码",
	energy: "能源 / 新能源",
	macro: "财经 / 宏观",
	robot: "机器人 / 自动化",
	science: "科学 / 前沿",
	security: "网络安全",
	semi: "半导体 / 芯片",
	space: "航天 / 太空",
	tech: "科技 / 互联网",
};

export const INDUSTRY_SOURCES: Record<string, RssSource[]> = {
	ai: [
		{
			name: "TechCrunch AI",
			url: "https://techcrunch.com/category/artificial-intelligence/feed/",
		},
		{
			name: "The Verge AI",
			url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
		},
		{
			name: "MIT Tech Review AI",
			url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
		},
		{ name: "OpenAI", url: "https://openai.com/news/rss.xml" },
	],
	auto: [
		{ name: "Electrek", url: "https://electrek.co/feed/" },
		{ name: "InsideEVs", url: "https://insideevs.com/rss/articles/all/" },
		{
			name: "The Verge Transport",
			url: "https://www.theverge.com/rss/transportation/index.xml",
		},
		{
			name: "TechCrunch Transport",
			url: "https://techcrunch.com/category/transportation/feed/",
		},
	],
	bio: [
		{ name: "STAT News", url: "https://www.statnews.com/feed/" },
		{ name: "Endpoints News", url: "https://endpts.com/feed/" },
		{ name: "FierceBiotech", url: "https://www.fiercebiotech.com/rss/xml" },
		{
			name: "BioPharma Dive",
			url: "https://www.biopharmadive.com/feeds/news/",
		},
	],
	consumer: [
		{ name: "Engadget", url: "https://www.engadget.com/rss.xml" },
		{ name: "9to5Mac", url: "https://9to5mac.com/feed/" },
		{ name: "9to5Google", url: "https://9to5google.com/feed/" },
		{
			name: "Android Authority",
			url: "https://www.androidauthority.com/feed/",
		},
	],
	energy: [
		{ name: "CleanTechnica", url: "https://cleantechnica.com/feed/" },
		{ name: "Utility Dive", url: "https://www.utilitydive.com/feeds/news/" },
		{ name: "pv magazine", url: "https://www.pv-magazine.com/feed/" },
		{ name: "OilPrice", url: "https://oilprice.com/rss/main" },
	],
	macro: [
		{
			name: "CNBC",
			url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
		},
		{ name: "Financial Times", url: "https://www.ft.com/rss/home" },
		{
			name: "WSJ Markets",
			url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
		},
		{
			name: "MarketWatch",
			url: "https://feeds.marketwatch.com/marketwatch/topstories/",
		},
	],
	robot: [
		{ name: "The Robot Report", url: "https://www.therobotreport.com/feed/" },
		{
			name: "IEEE Spectrum 机器人",
			url: "https://spectrum.ieee.org/feeds/topic/robotics.rss",
		},
		{ name: "Robohub", url: "https://robohub.org/feed/" },
		{
			name: "Robotics & Automation",
			url: "https://roboticsandautomationnews.com/feed/",
		},
	],
	science: [
		{ name: "Nature News", url: "https://www.nature.com/nature.rss" },
		{ name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml" },
		{
			name: "Quanta Magazine",
			url: "https://api.quantamagazine.org/feed/",
		},
		{ name: "New Scientist", url: "https://www.newscientist.com/feed/home/" },
	],
	security: [
		{ name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
		{
			name: "The Hacker News",
			url: "https://feeds.feedburner.com/TheHackersNews",
		},
		{
			name: "BleepingComputer",
			url: "https://www.bleepingcomputer.com/feed/",
		},
		{ name: "Dark Reading", url: "https://www.darkreading.com/rss.xml" },
	],
	semi: [
		{ name: "EE Times", url: "https://www.eetimes.com/feed/" },
		{
			name: "Semiconductor Engineering",
			url: "https://semiengineering.com/feed/",
		},
		{
			name: "IEEE Spectrum 半导体",
			url: "https://spectrum.ieee.org/feeds/topic/semiconductors.rss",
		},
		{ name: "DIGITIMES", url: "https://www.digitimes.com/rss/daily.xml" },
	],
	space: [
		{ name: "SpaceNews", url: "https://spacenews.com/feed/" },
		{ name: "Space.com", url: "https://www.space.com/feeds/all" },
		{ name: "Spaceflight Now", url: "https://spaceflightnow.com/feed/" },
		{ name: "NASA", url: "https://www.nasa.gov/news-release/feed/" },
	],
	tech: [
		{ name: "TechCrunch", url: "https://techcrunch.com/feed/" },
		{ name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
		{
			name: "Ars Technica",
			url: "https://feeds.arstechnica.com/arstechnica/index",
		},
		{ name: "WIRED", url: "https://www.wired.com/feed/rss" },
	],
};
