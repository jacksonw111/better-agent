import { vi } from "vitest";
import type { JsonRpcIo } from "./jsonrpc-io";
import type { ProcessExitInfo } from "./process-io";

// Shared fake `JsonRpcIo` for the opencode adapter tests, split out of
// opencode.test.ts to keep that file under the repo's max-lines-per-file gate
// and to let opencode-startup-config.test.ts reuse it. Not a `*.test.*` file,
// so vitest's include glob skips it; each importing test file still declares
// its own `vi.mock("./jsonrpc-io")`.

export type RequestHandler = (
	id: number,
	method: string,
	params: unknown
) => void;
export type NotificationHandler = (method: string, params: unknown) => void;

/** A fake `JsonRpcIo` whose exit, server-initiated requests, and notifications
 * can be triggered on demand by the test, standing in for the real `opencode
 * acp` process opencode.ts spawns. */
export function createFakeRpc(): {
	rpc: JsonRpcIo;
	triggerExit(info: ProcessExitInfo): void;
	triggerNotification(method: string, params: unknown): void;
	triggerRequest(id: number, method: string, params: unknown): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const requestHandlers: RequestHandler[] = [];
	const notificationHandlers: NotificationHandler[] = [];
	return {
		rpc: {
			notify: vi.fn(),
			onExit: (handler) => exitHandlers.push(handler),
			onNotification: (handler) => notificationHandlers.push(handler),
			onRequest: (handler) => requestHandlers.push(handler),
			respond: vi.fn(),
			request: vi.fn((method: string) => {
				if (method === "session/new") {
					return Promise.resolve({ sessionId: "session_1" });
				}
				return Promise.resolve({});
			}),
			stop: vi.fn(),
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
		triggerNotification(method: string, params: unknown): void {
			for (const handler of notificationHandlers) {
				handler(method, params);
			}
		},
		triggerRequest(id: number, method: string, params: unknown): void {
			for (const handler of requestHandlers) {
				handler(id, method, params);
			}
		},
	};
}
