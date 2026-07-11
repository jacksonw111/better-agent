const MS_PER_SEC = 1000;
const SECS_PER_MINUTE = 60;
const SECS_PER_HOUR = 3600;
const SECS_PER_DAY = 86_400;
const SECS_PER_WEEK = 604_800;
const SECS_PER_MONTH = 2_592_000;
const SECS_PER_YEAR = 31_536_000;

const FORMATTERS = {
	en: new Intl.RelativeTimeFormat("en", { numeric: "auto" }),
	// The quota section's copy is Chinese per the refactor plan
	// (docs/local-agent-refactor-plan.md §4.4 "剩余x%·y后重置").
	"zh-CN": new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }),
} as const;

export type RelativeTimeLocale = keyof typeof FORMATTERS;

export function relativeTime(
	iso: string,
	locale: RelativeTimeLocale = "en"
): string {
	const rtf = FORMATTERS[locale];
	const diffSec = Math.round(
		(new Date(iso).getTime() - Date.now()) / MS_PER_SEC
	);
	const abs = Math.abs(diffSec);
	if (abs < SECS_PER_MINUTE) {
		return rtf.format(diffSec, "second");
	}
	if (abs < SECS_PER_HOUR) {
		return rtf.format(Math.round(diffSec / SECS_PER_MINUTE), "minute");
	}
	if (abs < SECS_PER_DAY) {
		return rtf.format(Math.round(diffSec / SECS_PER_HOUR), "hour");
	}
	if (abs < SECS_PER_WEEK) {
		return rtf.format(Math.round(diffSec / SECS_PER_DAY), "day");
	}
	if (abs < SECS_PER_MONTH) {
		return rtf.format(Math.round(diffSec / SECS_PER_WEEK), "week");
	}
	if (abs < SECS_PER_YEAR) {
		return rtf.format(Math.round(diffSec / SECS_PER_MONTH), "month");
	}
	return rtf.format(Math.round(diffSec / SECS_PER_YEAR), "year");
}
