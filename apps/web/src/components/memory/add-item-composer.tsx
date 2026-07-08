import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

const MIN_IMPORTANCE = 0;
const MAX_IMPORTANCE = 1;

/** "" → no importance; a number in [0,1] → that value; anything else → null
 * (invalid, blocks submit). */
function parseImportance(raw: string): number | null | undefined {
	const trimmed = raw.trim();
	let result: number | null | undefined;
	if (trimmed !== "") {
		const parsed = Number(trimmed);
		const valid =
			Number.isFinite(parsed) &&
			parsed >= MIN_IMPORTANCE &&
			parsed <= MAX_IMPORTANCE;
		result = valid ? parsed : null;
	}
	return result;
}

function useAddItem(onAdded: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.memory.addItem.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.memory.listItems.key(),
				});
				onAdded();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function useAddItemForm(memoryId: string) {
	const [content, setContent] = useState("");
	const [importanceRaw, setImportanceRaw] = useState("");

	const add = useAddItem(() => {
		setContent("");
		setImportanceRaw("");
	});

	const importance = parseImportance(importanceRaw);
	const importanceInvalid = importance === null;
	const canSubmit =
		content.trim() !== "" && !(importanceInvalid || add.isPending);

	const submit = () => {
		if (!canSubmit) {
			return;
		}
		add.mutate({
			memoryId,
			content: content.trim(),
			importance: importance ?? undefined,
		});
	};

	return {
		canSubmit,
		content,
		importanceInvalid,
		importanceRaw,
		isPending: add.isPending,
		setContent,
		setImportanceRaw,
		submit,
	};
}

/** The add-item composer: a fact plus an optional importance (0–1). Adding
 * embeds the content server-side, so the button shows a pending state until
 * the embedding round-trip completes. */
export function AddItemComposer({ memoryId }: { memoryId: string }) {
	const composer = useAddItemForm(memoryId);
	return (
		<form
			className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4"
			onSubmit={(event) => {
				event.preventDefault();
				composer.submit();
			}}
		>
			<div className="flex flex-col gap-2">
				<Label htmlFor="memory-item-content">Add an item</Label>
				<Textarea
					id="memory-item-content"
					onChange={(event) => composer.setContent(event.target.value)}
					placeholder="A fact your agents should remember…"
					rows={3}
					value={composer.content}
				/>
			</div>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-2">
					<Label htmlFor="memory-item-importance">
						Importance (0–1, optional)
					</Label>
					<Input
						aria-invalid={composer.importanceInvalid}
						className="w-32"
						id="memory-item-importance"
						inputMode="decimal"
						onChange={(event) => composer.setImportanceRaw(event.target.value)}
						placeholder="0.5"
						value={composer.importanceRaw}
					/>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-muted-foreground text-xs">
						Items are embedded for search when added.
					</span>
					<Button disabled={!composer.canSubmit} size="sm" type="submit">
						{composer.isPending ? "Embedding…" : "Add item"}
					</Button>
				</div>
			</div>
		</form>
	);
}
