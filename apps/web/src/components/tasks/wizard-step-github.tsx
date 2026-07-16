import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useId } from "react";

// Step 3 (GitHub) of the New Task wizard. In this slice it is a disabled
// placeholder — repository search and issue linking light up with Slice 4
// (S4-T2) — but the step itself already exists so the wizard keeps its fixed
// Runtime → Request → GitHub order and its no-Review Start (spec §8.4/§18.2).

export function WizardStepGithub() {
	const repositoryId = useId();
	const issuesId = useId();
	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">
				GitHub context lands with Slice 4 — repository and issue linking will
				appear here. You can start the task without it.
			</p>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={repositoryId}>GitHub repository</Label>
				<Input
					disabled
					id={repositoryId}
					placeholder="Search repositories or paste a URL"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={issuesId}>Linked issues</Label>
				<Input disabled id={issuesId} placeholder="Select a repository first" />
				<Button
					className="w-fit"
					disabled
					size="sm"
					type="button"
					variant="outline"
				>
					Add issue
				</Button>
			</div>
		</div>
	);
}
