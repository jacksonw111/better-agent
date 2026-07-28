// Persistent PTY session domain port (P25-A, DP-S1). A PTY session is the
// server's single source of truth for a long-lived terminal on one Computer: a
// stable `id` that survives viewer detach and CLI reconnect, so re-entering a
// terminal reattaches the SAME pty (scrollback + the running agent intact)
// instead of spawning a fresh one. The row is created BEFORE any pty exists —
// `createSession` mints the id, the CLI spawns the pty on the first OPEN that
// carries it, and detach never touches the row. `ended` is terminal: set by an
// explicit `endSession` (which also tells the CLI to kill the pty) or by
// `endStaleExcept` reconciliation when a restarted CLI no longer holds it.

export type PtySessionStatus = "active" | "ended";

// Fine-grained, live-period activity of the underlying agent (observability
// slice A). `status` (active/ended) stays the authoritative lifecycle; this is
// the CLI's per-turn signal — reported via the STATE frame (0x06), driven by
// the agent's hooks. Deliberately a plain string, NOT a closed enum: the
// upstream state machine may grow new values, and the server persists whatever
// the CLI sends (version-tolerant). These are the values the first machine
// emits — `starting` (session boot), `working` (a turn is running), `idle` (a
// turn finished, awaiting input), `ended` (the session is gone). `ended` is
// also stamped by the server when `status` flips to `ended`, keeping the two in
// sync.
export type PtyActivityState = "starting" | "working" | "idle" | "ended";

export interface PtySessionInsert {
	agentKind: string;
	computerId: string;
	/** Null for a home-directory terminal (no project cwd). */
	projectId: string | null;
	/** Server-generated display title (e.g. `Session 7/26 14:30`). */
	title: string;
	userId: string;
}

export interface PtySessionRow {
	/** Fine-grained live activity (observability slice A). Null until the CLI
	 * reports the first STATE frame; a plain string so an evolving upstream state
	 * machine is never rejected. See {@link PtyActivityState} for the first-version
	 * values. */
	activityState: string | null;
	/** When {@link activityState} was last set. Null until the first report. */
	activityStateAt: Date | null;
	agentKind: string;
	/** The underlying agent's resumable conversation id (P25-C): equals `id` for
	 * claude/pi, the captured id for codex/opencode, null until bound. */
	agentSessionId: string | null;
	/** Whether the underlying agent conversation was created at least once —
	 * drives create-vs-resume when the pty is respawned after death. */
	agentSessionStarted: boolean;
	computerId: string;
	createdAt: Date;
	id: string;
	lastActivityAt: Date;
	projectId: string | null;
	status: PtySessionStatus;
	title: string;
	userId: string;
}

export interface PtySessionStore {
	/** Persist a new active session and return it. The `id` is the stable
	 * sessionId the viewer/CLI multiplex every pty frame by. */
	create(input: PtySessionInsert): Promise<PtySessionRow>;
	/** Reconcile a Computer's live set after the CLI (re)connects: mark `ended`
	 * every still-active session on that Computer whose id is NOT in
	 * `aliveSessionIds`. Rows created within `graceMs` are spared so a session
	 * created-but-not-yet-opened (no pty yet, so absent from the CLI's list)
	 * isn't wrongly ended. */
	endStaleExcept(
		computerId: string,
		aliveSessionIds: string[],
		graceMs?: number
	): Promise<void>;
	/** Owner-scoped read; null when the row isn't the caller's. */
	getById(id: string, userId: string): Promise<PtySessionRow | null>;
	/** The owner's active sessions on one Computer, most-recently-active first.
	 * A `projectId` narrows to that project's sessions. */
	listActiveByComputer(
		userId: string,
		computerId: string,
		projectId?: string
	): Promise<PtySessionRow[]>;
	/** All the owner's active sessions across every Computer, most-recently-active
	 * first (a global "what's running" view). */
	listActiveByUser(userId: string): Promise<PtySessionRow[]>;
	/** Owner-scoped terminal transition; returns the ended row (so the caller can
	 * read its computerId to tell the CLI to kill the pty), or null when the row
	 * isn't the caller's. Idempotent. */
	markEnded(id: string, userId: string): Promise<PtySessionRow | null>;
	/** Mark the underlying agent conversation as created (P25-C), so a later
	 * respawn after the pty died resumes it instead of starting a new one. */
	markStarted(id: string): Promise<void>;
	/** Owner-scoped rename; null when the row isn't the caller's. */
	rename(
		id: string,
		userId: string,
		title: string
	): Promise<PtySessionRow | null>;
	/** Persist the session's fine-grained activity state (observability slice A),
	 * reported by the CLI via the STATE frame. Idempotent, keyed by `id` alone
	 * (the CLI is the trusted source). `state` is stored verbatim — the caller is
	 * responsible for trimming/dropping empties; unknown values are accepted so an
	 * evolving upstream state machine is never rejected. */
	setActivityState(id: string, state: string, at: Date): Promise<void>;
	/** Bind the underlying agent's resumable session id (P25-C). Called by the CLI
	 * (via the BIND control frame) once claude/codex has a conversation: for
	 * claude/pi it is the pty id itself; for codex/opencode it is the id captured
	 * from the agent's startup output. Also implies the conversation now exists —
	 * pair with `markStarted`. */
	setAgentSession(id: string, agentSessionId: string): Promise<void>;
	/** Bump last-activity for one session on a Computer (CLI liveness signal).
	 * Computer-scoped so a Computer can only touch its own sessions. */
	touchActivity(computerId: string, id: string): Promise<void>;
}
