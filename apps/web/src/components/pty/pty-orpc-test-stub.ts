// P25-B: the orpc.pty surface the PtySessionList touches at render
// (listSessions query + createSession/endSession mutation options), stubbed for
// the pages that embed the list. Shared by the Computer/Project detail suites
// so their vi.mock factories stay small and the stub can't drift between them.
// Imported inside an async vi.mock factory (`await import`) — never through
// vi.hoisted — so it's a plain module, not a hoisted literal.

const mutation = (result: unknown) => ({
	mutationOptions: (opts: Record<string, unknown>) => ({
		mutationFn: () => Promise.resolve(result),
		...opts,
	}),
});

export const ptyOrpcStub = {
	createSession: mutation({
		args: [],
		command: "claude",
		computerId: "computer-1",
		cwd: "",
		sessionId: "session-1",
	}),
	endSession: mutation({ ok: true }),
	listSessions: {
		key: () => ["pty", "listSessions"],
		queryOptions: (opts?: { input?: unknown }) => ({
			queryFn: () => Promise.resolve({ sessions: [] }),
			queryKey: ["pty", "listSessions", opts?.input],
		}),
	},
};
