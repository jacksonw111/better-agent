import { Button } from "@better-agent/ui/components/button";
import { DialogFooter } from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";

// The one project form, shared by the New and Edit dialogs so the two can't
// drift: name + Git URL (any host, https or the ssh form, validated inline)
// + a password-masked token whose helper copy each dialog supplies (optional
// on create; leave-blank-to-keep on edit).

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

export interface ProjectDraft {
	name: string;
	repoUrl: string;
	token: string;
}

export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
	name: "",
	repoUrl: "",
	token: "",
};

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
 * gets an inline explanation instead of a silently disabled submit. */
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

export function ProjectDraftFields({
	draft,
	onChange,
	tokenHint,
	tokenLabel,
}: {
	draft: ProjectDraft;
	onChange: (next: ProjectDraft) => void;
	tokenHint: string;
	tokenLabel: string;
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
			<Field id="project-token" label={tokenLabel}>
				<Input
					id="project-token"
					onChange={(event) =>
						onChange({ ...draft, token: event.target.value })
					}
					type="password"
					value={draft.token}
				/>
				<p className="text-muted-foreground text-xs">{tokenHint}</p>
			</Field>
		</div>
	);
}

/** The Cancel/submit footer both dialogs share — same layout, same disabled
 * and pending treatment, only the labels differ. */
export function ProjectDialogFooter({
	disabled,
	idleLabel,
	onCancel,
	onSubmit,
	pending,
	pendingLabel,
}: {
	disabled: boolean;
	idleLabel: string;
	onCancel: () => void;
	onSubmit: () => void;
	pending: boolean;
	pendingLabel: string;
}) {
	return (
		<DialogFooter>
			<Button onClick={onCancel} type="button" variant="outline">
				Cancel
			</Button>
			<Button disabled={disabled} onClick={onSubmit} type="button">
				{pending ? pendingLabel : idleLabel}
			</Button>
		</DialogFooter>
	);
}
