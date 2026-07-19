import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

// Q3: "New project" — registers a long-lived checkout of one git repository
// on this computer. Any git remote works: an https URL on any host, or the
// ssh form `git@host:path.git` (which clones with this computer's ssh keys).
// Creation queues the clone on the machine; the Projects list's poll
// (project-list.tsx) then follows created/cloning to ready/error. The token
// is OPTIONAL and omitted (not sent empty) when left blank.

/** scp-like ssh remote: `git@host:path(.git)` — mirrors the server's schema. */
const SSH_URL_PATTERN = /^[\w.-]+@[\w.-]+:\S+$/;

/** An http(s) URL on any host, or the ssh form — the server accepts exactly
 * these two shapes. */
export function isValidGitUrl(value: string): boolean {
	const trimmed = value.trim();
	if (SSH_URL_PATTERN.test(trimmed)) {
		return true;
	}
	try {
		const { protocol } = new URL(trimmed);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

interface Draft {
	name: string;
	repoUrl: string;
	token: string;
}

const EMPTY_DRAFT: Draft = { name: "", repoUrl: "", token: "" };

function Field({
	children,
	id,
	label,
}: {
	children: React.ReactNode;
	id: string;
	label: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			{children}
		</div>
	);
}

/** Any git remote works; a non-empty value that fits neither accepted shape
 * gets an inline explanation instead of a silently disabled Create. */
function GitUrlField({
	onChange,
	value,
}: {
	onChange: (next: string) => void;
	value: string;
}) {
	const showError = value.trim() !== "" && !isValidGitUrl(value);
	return (
		<Field id="project-repo-url" label="Git URL">
			<Input
				aria-invalid={showError || undefined}
				id="project-repo-url"
				onChange={(event) => onChange(event.target.value)}
				placeholder="https://github.com/owner/repo.git or git@host:group/repo.git"
				value={value}
			/>
			{showError && (
				<p className="text-destructive text-xs">
					Enter an https:// URL or an ssh address like git@host:group/repo.git.
				</p>
			)}
		</Field>
	);
}

function DraftFields({
	draft,
	onChange,
}: {
	draft: Draft;
	onChange: (next: Draft) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<Field id="project-name" label="Name">
				<Input
					id="project-name"
					onChange={(event) => onChange({ ...draft, name: event.target.value })}
					placeholder="My project"
					value={draft.name}
				/>
			</Field>
			<GitUrlField
				onChange={(repoUrl) => onChange({ ...draft, repoUrl })}
				value={draft.repoUrl}
			/>
			<Field id="project-token" label="Access token (optional)">
				<Input
					id="project-token"
					onChange={(event) =>
						onChange({ ...draft, token: event.target.value })
					}
					type="password"
					value={draft.token}
				/>
				<p className="text-muted-foreground text-xs">
					Only used with https URLs — ssh addresses clone with this computer's
					ssh keys.
				</p>
			</Field>
		</div>
	);
}

/** projects.create with the blank token OMITTED; success refreshes the list
 * (whose poll follows the clone) and hands control back to the dialog. */
function useCreateProject(computerId: string, onCreated: () => void) {
	const queryClient = useQueryClient();
	const create = useMutation(
		orpc.projects.create.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const submit = (draft: Draft) =>
		create.mutate(
			{
				computerId,
				name: draft.name.trim(),
				repoUrl: draft.repoUrl.trim(),
				token: draft.token === "" ? undefined : draft.token,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.projects.list.key(),
					});
					onCreated();
				},
			}
		);
	return { pending: create.isPending, submit };
}

/** Self-contained "New project" dialog — owns its trigger and open state so
 * the Projects section drops it into its header without wiring. */
export function NewProjectDialog({ computerId }: { computerId: string }) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setDraft(EMPTY_DRAFT);
		}
	};
	const create = useCreateProject(computerId, () => onOpenChange(false));
	const valid = draft.name.trim().length > 0 && isValidGitUrl(draft.repoUrl);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				New project
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader className="gap-1.5">
					<DialogTitle>New project</DialogTitle>
					<DialogDescription>
						Clone a git repository onto this computer — every session started
						from the project works in the same checkout.
					</DialogDescription>
				</DialogHeader>
				<DraftFields draft={draft} onChange={setDraft} />
				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!valid || create.pending}
						onClick={() => create.submit(draft)}
						type="button"
					>
						{create.pending ? "Creating…" : "Create project"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
