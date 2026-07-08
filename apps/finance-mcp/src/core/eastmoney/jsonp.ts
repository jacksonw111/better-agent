// Parse a JSONP body: `callback({...})` → the inner JSON object.
export function parseJsonp<T>(body: string): T {
	const start = body.indexOf("(");
	const end = body.lastIndexOf(")");
	if (start === -1 || end === -1 || end <= start) {
		return {} as T;
	}
	return JSON.parse(body.slice(start + 1, end)) as T;
}
