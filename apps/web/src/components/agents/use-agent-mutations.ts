import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { assignMemoriesSafely } from "@/components/memory/assign-memories";
import { assignSkillsSafely } from "@/components/skills/assign-skills";
import type { AgentRow } from "@/utils/api-types";
import { celebrateSuccess } from "@/utils/celebrate";
import { orpc } from "@/utils/orpc";
import { type AgentForm, agentRowToForm, toAgentInput } from "./agent-form";

// The agents-card.tsx wizard/mutation wiring, split out so that file (the
// table + skeleton + dialogs) stays under the repo's 300-line file cap.

export function useAgentWizard() {
	const [state, setState] = useState<{
		open: boolean;
		id: string | null;
		initial: AgentForm | null;
	}>({ open: false, id: null, initial: null });
	const openAdd = () => setState({ open: true, id: null, initial: null });
	const openEdit = (row: AgentRow) =>
		setState({ open: true, id: row.id, initial: agentRowToForm(row) });
	const close = (open: boolean) => setState((s) => ({ ...s, open }));
	return { state, openAdd, openEdit, close };
}

function useCreateAgent({
	pendingMemoryIds,
	pendingSkillIds,
	onTokenMinted,
	onSaved,
	invalidate,
}: {
	pendingMemoryIds: { current: string[] };
	pendingSkillIds: { current: string[] };
	onTokenMinted: (token: string) => void;
	onSaved: () => void;
	invalidate: () => void;
}) {
	return useMutation(
		orpc.agents.create.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					assignMemoriesSafely(
						{ agentId: result.agent.id },
						pendingMemoryIds.current
					),
					assignSkillsSafely(result.agent.id, pendingSkillIds.current),
				]);
				pendingMemoryIds.current = [];
				pendingSkillIds.current = [];
				celebrateSuccess("Agent created");
				onTokenMinted(result.token);
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

export function useAgentMutations(
	onSaved: () => void,
	onTokenMinted: (token: string) => void
) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
	// The Memories/Skills steps' selections, captured at submit time so the
	// create mutation's onSuccess can turn them into real assignments (the
	// agent id only exists after the create round-trip).
	const pendingMemoryIds = useRef<string[]>([]);
	const pendingSkillIds = useRef<string[]>([]);
	const create = useCreateAgent({
		invalidate,
		onSaved,
		onTokenMinted,
		pendingMemoryIds,
		pendingSkillIds,
	});
	const update = useMutation(
		orpc.agents.update.mutationOptions({
			onSuccess: () => {
				celebrateSuccess("Agent updated");
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const remove = useMutation(
		orpc.agents.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Agent deleted");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const submit = (editingId: string | null, form: AgentForm) => {
		const input = toAgentInput(form);
		if (editingId === null) {
			pendingMemoryIds.current = form.memoryIds;
			pendingSkillIds.current = form.skillIds;
			create.mutate(input);
		} else {
			update.mutate({ id: editingId, ...input });
		}
	};
	return { create, update, remove, submit };
}

export function useRevealToken() {
	const queryClient = useQueryClient();
	const [revealToken, setRevealToken] = useState<string | null>(null);
	const handleTokenRotated = (token: string) => {
		setRevealToken(token);
		queryClient.invalidateQueries({ queryKey: orpc.agents.getToken.key() });
	};
	return { revealToken, setRevealToken, handleTokenRotated };
}
