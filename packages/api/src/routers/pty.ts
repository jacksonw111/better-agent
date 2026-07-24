import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { authorizedUserProcedure } from "../index";

// PTY router (P2-3a): the clean session↔computer binding the web needs to open
// a real terminal without hand-crafting a `?pty=` URL. `createSession` mints a
// fresh sessionId, authorizes the target computer (and optional project) for
// the caller, and resolves the spawn spec (which runtime binary, in which
// directory). The web then opens `/pty/viewer-ws` and sends an OPEN frame
// carrying this spec; the CLI's PTY transport spawns the pty. The server never
// spawns anything and stores no PTY state — the pty's own liveness (exit/CLOSE)
// is the whole run state (DP-PTY2, plan §P2-4).

const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;

// The CLI binary each runtime maps to (mirrors the CLI's AGENT_CLI table). The
// browser relays this in the OPEN spec, but it is decided HERE — a viewer can
// only ask its own computer to run one of the known agent runtimes, never an
// arbitrary command it invents.
const AGENT_BINARY: Record<(typeof AGENT_KINDS)[number], string> = {
	"claude-code": "claude",
	opencode: "opencode",
	codex: "codex",
	pi: "pi",
};

/** `createSession` — authorize a computer (and optional project) for the
 * caller, then return a fresh sessionId plus the resolved spawn spec. An empty
 * `cwd` means "the computer's home directory" (resolved CLI-side); a project's
 * `localPath` is used when a ready project is named. */
const createSession = authorizedUserProcedure
	.input(
		z.object({
			agentKind: z.enum(AGENT_KINDS),
			computerId: z.uuid(),
			projectId: z.uuid().optional(),
		})
	)
	.handler(async ({ input, context }) => {
		const userId = context.authedUser.id;
		const computer = await context.services.stores.computer.getById(
			input.computerId
		);
		if (!computer || computer.userId !== userId) {
			throw new ORPCError("NOT_FOUND", { message: "Computer not found" });
		}

		let cwd = "";
		if (input.projectId) {
			const project = await context.services.stores.project.getById(
				input.projectId,
				userId
			);
			if (!project || project.computerId !== input.computerId) {
				throw new ORPCError("NOT_FOUND", { message: "Project not found" });
			}
			if (project.status !== "ready" || !project.localPath) {
				throw new ORPCError("PRECONDITION_FAILED", {
					message:
						"Project isn't cloned yet — wait for it to finish, then open a terminal.",
				});
			}
			cwd = project.localPath;
		}

		return {
			args: [] as string[],
			command: AGENT_BINARY[input.agentKind],
			computerId: input.computerId,
			cwd,
			sessionId: crypto.randomUUID(),
		};
	});

export const ptyRouter = {
	createSession,
};
