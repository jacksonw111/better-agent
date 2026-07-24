import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderIcon, GlobeIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import type { MemoryRow } from "./memory-types";

// DP2 scope surface for the Memories list: a per-row reach badge, a scope
// filter, and a "move memory to global / a project" menu — all sharing one
// projects lookup so the badge label and the picker can never drift.

export interface ProjectOption {
	id: string;
	name: string;
}

/** The "all scopes" and "global only" sentinels for the scope filter — every
 * other filter value is a projectId. */
export const SCOPE_FILTER_ALL = "all";
export const SCOPE_FILTER_GLOBAL = "global";

/** The caller's projects across every computer (projects.listMine), narrowed
 * to the id + name the scope badge and picker need. */
export function useProjectOptions(): ProjectOption[] {
	const projects = useQuery(orpc.projects.listMine.queryOptions());
	return (projects.data ?? []).map((project) => ({
		id: project.id,
		name: project.name,
	}));
}

function projectLabel(
	projects: ProjectOption[],
	projectId: string | null
): string {
	return (
		projects.find((project) => project.id === projectId)?.name ?? "Project"
	);
}

/** True when a memory belongs in the currently selected scope filter. */
export function matchesScopeFilter(
	memory: Pick<MemoryRow, "scope" | "projectId">,
	filter: string
): boolean {
	if (filter === SCOPE_FILTER_ALL) {
		return true;
	}
	if (filter === SCOPE_FILTER_GLOBAL) {
		return memory.scope === "global";
	}
	return memory.scope === "project" && memory.projectId === filter;
}

/** The reach badge: a globe for global memories, a folder + project name for
 * project ones. */
export function MemoryScopeBadge({
	memory,
	projects,
}: {
	memory: Pick<MemoryRow, "scope" | "projectId">;
	projects: ProjectOption[];
}) {
	if (memory.scope === "global") {
		return (
			<Badge className="gap-1" variant="outline">
				<GlobeIcon className="size-3" />
				Global
			</Badge>
		);
	}
	return (
		<Badge className="gap-1" variant="secondary">
			<FolderIcon className="size-3" />
			{projectLabel(projects, memory.projectId)}
		</Badge>
	);
}

/** The list toolbar's scope filter: All / Global / one entry per project. */
export function ScopeFilter({
	value,
	onValueChange,
	projects,
}: {
	value: string;
	onValueChange: (value: string) => void;
	projects: ProjectOption[];
}) {
	return (
		<Select
			onValueChange={(next) => onValueChange(next ?? SCOPE_FILTER_ALL)}
			value={value}
		>
			<SelectTrigger aria-label="Filter by scope" className="w-44" size="sm">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={SCOPE_FILTER_ALL}>All scopes</SelectItem>
				<SelectItem value={SCOPE_FILTER_GLOBAL}>Global</SelectItem>
				{projects.map((project) => (
					<SelectItem key={project.id} value={project.id}>
						{project.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function useSetScope() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.memory.setMemoryScope.mutationOptions({
			onSuccess: () => {
				toast.success("Memory scope updated");
				queryClient.invalidateQueries({
					queryKey: orpc.memory.listMemories.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

/** Per-row scope changer: move a memory to global, or to any of the user's
 * projects (project↔global). The current reach is disabled so it can't be
 * re-selected. */
export function ChangeScopeMenu({
	memory,
	projects,
}: {
	memory: MemoryRow;
	projects: ProjectOption[];
}) {
	const setScope = useSetScope();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
				Scope
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Move to</DropdownMenuLabel>
				<DropdownMenuItem
					disabled={memory.scope === "global"}
					onClick={() => setScope.mutate({ id: memory.id, scope: "global" })}
				>
					<GlobeIcon className="size-4" />
					Global
				</DropdownMenuItem>
				{projects.length > 0 ? <DropdownMenuSeparator /> : null}
				{projects.map((project) => (
					<DropdownMenuItem
						disabled={
							memory.scope === "project" && memory.projectId === project.id
						}
						key={project.id}
						onClick={() =>
							setScope.mutate({
								id: memory.id,
								scope: "project",
								projectId: project.id,
							})
						}
					>
						<FolderIcon className="size-4" />
						{project.name}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
