import { Button } from "@better-agent/ui/components/button";
import { DialogFooter } from "@better-agent/ui/components/dialog";

/** Cancel + Save footer shared by the standard and template dialogs. `Save` is
 * the form's submit button, so the parent form's onSubmit drives it. */
export function DialogFormFooter({
	disabled,
	pending,
	onCancel,
}: {
	disabled: boolean;
	pending: boolean;
	onCancel: () => void;
}) {
	return (
		<DialogFooter className="gap-2">
			<Button onClick={onCancel} type="button" variant="outline">
				Cancel
			</Button>
			<Button disabled={disabled} type="submit">
				{pending ? "Saving…" : "Save"}
			</Button>
		</DialogFooter>
	);
}
