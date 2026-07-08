// apps/web/src/components/dashboard/dashboard-constants.ts

// eslint-disable-next-line no-magic-numbers
export const WINDOW_OPTIONS = [3, 7, 12] as const;
export type WindowDays = (typeof WINDOW_OPTIONS)[number];

export const DEFAULT_WINDOW: WindowDays = 7;

/** Cents in one dollar, for cost display */
export const CENTS_PER_DOLLAR = 100;

/** Chart color for input tokens */
export const COLOR_INPUT = "#6366f1";

/** Chart color for output tokens */
export const COLOR_OUTPUT = "#f59e0b";

/** Chart color for cost (right axis) */
export const COLOR_COST = "#10b981";
