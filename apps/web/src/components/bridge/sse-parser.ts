// Incremental text/event-stream parser: feed it decoded chunks as they
// arrive off a fetch body reader, get back any complete events found so far.
// Kept free of fetch/DOM APIs so it's testable with plain strings.

interface RawSseEvent {
	data: string;
	id: number;
}

const DATA_PREFIX = "data:";
const ID_PREFIX = "id:";
const COMMENT_PREFIX = ":";

interface ParserState {
	buffer: string;
	dataLines: string[];
	id: number | null;
}

function stripTrailingCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function consumeLine(
	state: ParserState,
	line: string,
	out: RawSseEvent[]
): void {
	if (line === "") {
		if (state.dataLines.length > 0 && state.id !== null) {
			out.push({ id: state.id, data: state.dataLines.join("\n") });
		}
		state.dataLines = [];
		state.id = null;
		return;
	}
	if (line.startsWith(COMMENT_PREFIX)) {
		return; // comment line (heartbeat ":ping")
	}
	if (line.startsWith(DATA_PREFIX)) {
		state.dataLines.push(line.slice(DATA_PREFIX.length).trimStart());
		return;
	}
	if (line.startsWith(ID_PREFIX)) {
		const parsed = Number(line.slice(ID_PREFIX.length).trim());
		state.id = Number.isFinite(parsed) ? parsed : state.id;
	}
}

export interface SseParser {
	feed: (chunk: string) => RawSseEvent[];
}

export function createSseParser(): SseParser {
	const state: ParserState = { buffer: "", dataLines: [], id: null };
	return {
		feed(chunk: string): RawSseEvent[] {
			state.buffer += chunk;
			const lines = state.buffer.split("\n");
			state.buffer = lines.pop() ?? "";
			const out: RawSseEvent[] = [];
			for (const line of lines) {
				consumeLine(state, stripTrailingCr(line), out);
			}
			return out;
		},
	};
}
