import type { ReactNode } from "react";
import type { ZodType } from "zod";
import { unwrapToolResult } from "./envelope";

/** Long tool results (a search returning dozens of rows) render at most this
 * many items, plus a "+N more" line — a chat pane isn't a data grid. */
export const MAX_RENDERED_ITEMS = 20;

export interface ToolResultRenderer {
	/** Parses a raw tool-result value (see unwrapToolResult) into render-ready
	 * data, or null when it doesn't match this tool's expected shape. */
	parse(result: unknown): unknown;
	render(data: unknown): ReactNode;
}

// `data as T` below is a closed type-erasure box: `parse` and `render` are
// always built from the SAME schema/render pair in `entry`, so the cast can
// never see a mismatched value — there's no `unknown`-typed public API that
// lets a caller mix parse output from one entry with render from another.
export function entry<T>(
	schema: ZodType<T>,
	render: (data: T) => ReactNode
): ToolResultRenderer {
	return {
		parse: (result: unknown) => {
			const parsed = schema.safeParse(unwrapToolResult(result));
			return parsed.success ? parsed.data : null;
		},
		render: (data: unknown) => render(data as T),
	};
}

// Per-ELEMENT tolerant list parse: scraped data is messy, so a single
// malformed item must not blank the whole render the way `z.array(schema)`
// would — validate each element and keep the good ones. Only a fully-
// unparseable result (a non-array, or an array where EVERY element fails —
// i.e. the shape is wrong, not just one stray item) returns null so the caller
// can fall back to the raw tool block.
export function listEntry<T>(
	elementSchema: ZodType<T>,
	render: (data: T[]) => ReactNode
): ToolResultRenderer {
	return {
		parse: (result: unknown) => {
			const unwrapped = unwrapToolResult(result);
			if (!Array.isArray(unwrapped)) {
				return null;
			}
			const valid: T[] = [];
			for (const item of unwrapped) {
				const parsed = elementSchema.safeParse(item);
				if (parsed.success) {
					valid.push(parsed.data);
				}
			}
			if (unwrapped.length > 0 && valid.length === 0) {
				return null;
			}
			return valid;
		},
		render: (data: unknown) => render(data as T[]),
	};
}
