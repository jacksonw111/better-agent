import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import type { ConfigDraft } from "./local-agent-config-form";

// Model + permission-mode startup-config fields (R2-a), split out of
// local-agent-config-form.tsx to keep that file under the repo's 300-line
// limit. Gating on the agent's capabilities (modelSwitch / permissionModes)
// happens in ConfigTab, not here — these just render once shown.

interface FieldProps {
	draft: ConfigDraft;
	onDraft: (next: ConfigDraft) => void;
}

/** Startup model id, as free text: the live model list isn't available before
 * a session runs (unlike the mid-session model picker), so this can't be a
 * Select the way permission mode is. */
export function ModelField({ draft, onDraft }: FieldProps) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="model">Model</Label>
			<Input
				id="model"
				onChange={(event) => onDraft({ ...draft, model: event.target.value })}
				placeholder="SDK default"
				value={draft.model}
			/>
			<p className="text-muted-foreground text-xs">
				Model the next session starts with.
			</p>
		</div>
	);
}

/** Sentinel for the "unset/default" option, which clears the persisted
 * permissionMode on save (see configFromDraft) — Radix's Select can't use an
 * empty string as an item value. */
const UNSET_PERMISSION_MODE = "__unset__";

/** Base-ui's `onValueChange` reports `string | null`; a `null` pick (nothing
 * selected) leaves the draft untouched, mirroring how the effort Select
 * guards its own `onValueChange` in local-agent-config-form.tsx. */
function resolvePermissionMode(next: unknown, current: string): string {
	if (typeof next !== "string") {
		return current;
	}
	return next === UNSET_PERMISSION_MODE ? "" : next;
}

export function PermissionModeField({
	draft,
	onDraft,
	permissionModes,
}: FieldProps & { permissionModes: string[] }) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="permission-mode">Permission mode</Label>
			<Select
				onValueChange={(next) =>
					onDraft({
						...draft,
						permissionMode: resolvePermissionMode(next, draft.permissionMode),
					})
				}
				value={draft.permissionMode || UNSET_PERMISSION_MODE}
			>
				<SelectTrigger id="permission-mode" size="sm">
					<SelectValue placeholder="Default" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={UNSET_PERMISSION_MODE}>Default</SelectItem>
					{permissionModes.map((mode) => (
						<SelectItem key={mode} value={mode}>
							{mode}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs">
				Permission mode the next session starts with.
			</p>
		</div>
	);
}
