import {
	type SessionFixture,
	workspaceStore,
} from "./local-agent-workspace-test-utils";

// The `@/utils/orpc` mock builder for the workspace/flow/palette tests —
// split out of local-agent-workspace-test-utils.tsx to keep that file under
// the repo's 300-line cap once the P3-T1 session-mgmt mocks landed. Same
// constraint as the utils file: imports NO app modules, so `vi.mock`
// factories can `await import(...)` it without a mock-resolution cycle.

function stubQuery<T>(key: string[], get: () => T) {
	return {
		queryOptions: () => ({
			queryKey: key,
			queryFn: () => Promise.resolve(get()),
		}),
		key: () => key,
	};
}

function stubMutation<T>(result: T) {
	return (opts: Record<string, unknown>) => ({
		mutationFn: () => Promise.resolve(result),
		...opts,
	});
}

/** P3-T1: one session-mgmt client mock — records the call, applies `apply` to
 * the matching session fixture, resolves `{ ok: true }`. `deleteSession`
 * passes null to drop the row instead. */
function mgmtRoute(
	route: string,
	apply: ((session: SessionFixture, input: never) => void) | null
) {
	return (input: { sessionId: string }) => {
		workspaceStore.mgmtCalls.push({ route, input });
		if (apply === null) {
			workspaceStore.sessions = workspaceStore.sessions.filter(
				(session) => session.id !== input.sessionId
			);
		} else {
			const session = workspaceStore.sessions.find(
				(candidate) => candidate.id === input.sessionId
			);
			if (session) {
				apply(session, input as never);
			}
		}
		return Promise.resolve({ ok: true });
	};
}

/** The mgmt half of the `client.bridge` mock, split out of `buildOrpcMock` to
 * keep it under the max-lines-per-function gate. Mutations mirror the real
 * routes' store effects so refetch-after-invalidate shows the new state. */
function buildMgmtClientMock() {
	return {
		renameSession: mgmtRoute(
			"renameSession",
			(session, input: { name: string | null }) => {
				session.name = input.name;
			}
		),
		starSession: mgmtRoute(
			"starSession",
			(session, input: { starred: boolean }) => {
				session.starred = input.starred;
			}
		),
		archiveSession: mgmtRoute("archiveSession", (session) => {
			session.archivedAt = new Date();
			session.status = "ended";
		}),
		restoreSession: mgmtRoute("restoreSession", (session) => {
			session.archivedAt = null;
		}),
		deleteSession: mgmtRoute("deleteSession", null),
	};
}

/** The store's sessions as one `listSessions` page for `input`: the archived
 * flag filters like the server does (default excludes, true = only). */
function listSessionsPage(input?: { archived?: boolean }) {
	return {
		sessions: workspaceStore.sessions.filter((session) =>
			input?.archived
				? session.archivedAt !== null
				: session.archivedAt === null
		),
		nextCursor: workspaceStore.firstNextCursor,
	};
}

/** The `@/utils/orpc` mock: queries read the live store; "Load more" records
 * its cursor and serves the store's canned older page; the session-mgmt
 * mutations record their calls and mutate the store like the real routes. */
export function buildOrpcMock() {
	return {
		client: {
			bridge: {
				listSessions: (input: { cursor?: string; archived?: boolean }) => {
					if (input.cursor !== undefined) {
						workspaceStore.loadMoreCursors.push(input.cursor);
						return Promise.resolve(workspaceStore.olderPage);
					}
					return Promise.resolve(listSessionsPage(input));
				},
				...buildMgmtClientMock(),
			},
		},
		orpc: {
			auth: {
				me: stubQuery(["auth", "me"], () => ({
					email: "tester@example.com",
				})),
			},
			bridge: {
				listSessions: {
					queryOptions: (opts?: { input?: { archived?: boolean } }) => ({
						queryKey: ["bridge", "listSessions", opts?.input ?? {}],
						queryFn: () => Promise.resolve(listSessionsPage(opts?.input)),
					}),
					key: () => ["bridge", "listSessions"],
				},
				listTokens: stubQuery(
					["bridge", "listTokens"],
					() => workspaceStore.tokens
				),
				createToken: {
					mutationOptions: stubMutation({
						id: "new-token",
						token: "bt_new",
						last4: "_new",
					}),
				},
				endSession: { mutationOptions: stubMutation({ ok: true }) },
				deleteToken: { mutationOptions: stubMutation({ ok: true }) },
			},
		},
	};
}
