// V6 batch (a-stock-data / global-stock-data / investment-news ports):
// merges the 打板 + 舆情 + A股扩展 + 美股/行业新闻 handler records into one
// spreadable record, so tools-impl.ts (at the 300-line cap) only needs a
// single import + spread.

import type { ToolEnv, ToolResult } from "./tools-impl";
import { BUZZ_HANDLERS } from "./tools-impl-buzz";
import { CNX_HANDLERS } from "./tools-impl-cnx";
import { GLOBAL_HANDLERS } from "./tools-impl-global";
import { LIMITUP_HANDLERS } from "./tools-impl-limitup";

export const V6_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	...LIMITUP_HANDLERS,
	...BUZZ_HANDLERS,
	...CNX_HANDLERS,
	...GLOBAL_HANDLERS,
};
