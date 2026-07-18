// Project domain port types (Q1). A Project is a long-lived checkout of one
// GitHub repository on one Computer: a fixed directory, cloned once, shared as
// the cwd by every session started against it — replacing per-session
// workspaces for repository work (stand-alone sessions keep their managed
// directories). The CLI derives the directory as
// `~/.better-agent/projects/<first 8 of projectId>-<repo short name>/`; the
// server never invents the path — the client reports the absolute `localPath`
// back with the clone result.

/** Project lifecycle. `created` doubles as the clone-delivery queue (D4's
 * "queue IS the state" pattern): a still-`created` Project renders as a
 * pending `clone_project` command until the client acks it to `cloning`. */
export type ProjectStatus = "created" | "cloning" | "ready" | "error";

export interface ProjectInsert {
	computerId: string;
	/** Secret-box ciphertext of the repository credential the user configured
	 * for this Computer, or null for public repositories. Unlike the
	 * server-side GitHub Connection (which never leaves the server), this token
	 * is DELIBERATELY sent to the client once, inside the clone command, so git
	 * can authenticate on the user's own machine — an intentional product
	 * decision, not a leak. It still never appears in any user-facing response
	 * (list/get expose tokenLast4 only). */
	encryptedToken: string | null;
	name: string;
	repoCloneUrl: string;
	repoFullName: string;
	tokenLast4: string | null;
	userId: string;
}

export interface ProjectRow extends ProjectInsert {
	createdAt: Date;
	/** The real clone failure, reported verbatim by the client — never a
	 * synthesized message. Null unless status is `error`. */
	errorMessage: string | null;
	id: string;
	/** Client-reported absolute path of the checkout, set with the `ready`
	 * report. Null until the clone completes. */
	localPath: string | null;
	status: ProjectStatus;
	updatedAt: Date;
}

/** Partial status update from the clone state machine: ack → `cloning`,
 * result → `ready` (+localPath) or `error` (+errorMessage). Omitted fields
 * stay untouched. */
export interface ProjectStatusUpdate {
	errorMessage?: string | null;
	localPath?: string | null;
	status: ProjectStatus;
}

/** The clone command delivered over the computer control channel (WS push +
 * heartbeat pendingCommands, same dual path as Launch Commands). Idempotent
 * by construction: `projectId` is the idempotency key — only a `created`
 * Project produces one, and the client's ack (projects.ackClone) moves it to
 * `cloning`, removing it from the derivation. */
export interface ProjectCloneCommand {
	kind: "clone_project";
	projectId: string;
	repoCloneUrl: string;
	/** Decrypted repository credential for git authentication on the client —
	 * present only when the user configured one for this Project. This one-time
	 * delivery to the user's own machine is an intentional product decision
	 * (see ProjectInsert.encryptedToken); server-side GitHub Connection tokens
	 * are still never sent. */
	token?: string;
}

export interface ProjectStore {
	/** Owner-scoped delete; false when the row isn't the caller's. Deletes the
	 * DB row ONLY — the checkout directory on the Computer is the user's local
	 * data and is never removed by the server. */
	delete(id: string, userId: string): Promise<boolean>;
	/** Owner-scoped read; null when the row isn't the caller's. */
	getById(id: string, userId: string): Promise<ProjectRow | null>;
	/** Computer-plane read (ackClone/reportCloneResult); null when the Project
	 * isn't on that Computer. */
	getByIdForComputer(
		id: string,
		computerId: string
	): Promise<ProjectRow | null>;
	insert(input: ProjectInsert): Promise<ProjectRow>;
	/** The owner's Projects on one Computer, newest first. */
	listByComputer(userId: string, computerId: string): Promise<ProjectRow[]>;
	/** The Computer's clone-delivery queue (D4): its still-`created` Projects,
	 * oldest first. A Project leaves this list when its ack flips it to
	 * `cloning`. */
	listCreatedByComputer(computerId: string): Promise<ProjectRow[]>;
	/** False when the Project is unknown; unspecified fields stay untouched. */
	updateStatus(id: string, update: ProjectStatusUpdate): Promise<boolean>;
}
