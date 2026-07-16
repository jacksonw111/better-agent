import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

// GitHub Connection tab (S4-T1, master spec §5.5): one fine-grained PAT per
// user, stored encrypted server-side. The token is write-only from here —
// after connect the UI only ever sees its last 4 characters.

const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

function useConnect(onConnected: (login: string) => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.github.connect.mutationOptions({
			onSuccess: ({ login }) => {
				queryClient.invalidateQueries({ queryKey: orpc.github.status.key() });
				toast.success(`Connected to GitHub as ${login}`);
				onConnected(login);
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function useDisconnect(onDisconnected: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.github.disconnect.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.github.status.key() });
				toast.success("GitHub disconnected");
				onDisconnected();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function TokenHelp() {
	return (
		<p className="text-muted-foreground text-sm">
			Paste a{" "}
			<a
				className="underline underline-offset-2 hover:text-foreground"
				href={NEW_TOKEN_URL}
				rel="noopener noreferrer"
				target="_blank"
			>
				fine-grained personal access token
			</a>{" "}
			so Better Agent can find your repositories and issues when composing
			tasks. It only needs read access to <strong>Repository metadata</strong>{" "}
			and <strong>Issues</strong> — the token is encrypted at rest and never
			shared with your computers.
		</p>
	);
}

function ConnectForm({
	pending,
	onSubmit,
}: {
	pending: boolean;
	onSubmit: (token: string) => void;
}) {
	const [token, setToken] = useState("");
	return (
		<form
			className="flex max-w-lg flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(token.trim());
			}}
		>
			<TokenHelp />
			<div className="flex flex-col gap-1">
				<Label htmlFor="github-pat">Personal access token</Label>
				<Input
					autoComplete="off"
					id="github-pat"
					onChange={(event) => setToken(event.target.value)}
					placeholder="github_pat_…"
					required
					type="password"
					value={token}
				/>
			</div>
			<Button
				className="self-start"
				disabled={pending || token.trim() === ""}
				type="submit"
			>
				{pending ? "Connecting…" : "Connect GitHub"}
			</Button>
		</form>
	);
}

function ConnectedCard({
	login,
	tokenLast4,
	pending,
	onDisconnect,
}: {
	login: string | null;
	tokenLast4: string | undefined;
	pending: boolean;
	onDisconnect: () => void;
}) {
	return (
		<div className="flex max-w-lg flex-wrap items-center gap-3 rounded-lg bg-muted/50 p-4">
			<GitBranchIcon aria-hidden className="size-5 shrink-0" />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="font-medium text-sm">
					{login ? `Connected as ${login}` : "GitHub connected"}
				</span>
				<span className="font-mono text-muted-foreground text-sm">
					{`Token ••••${tokenLast4 ?? ""}`}
				</span>
			</div>
			<Button
				disabled={pending}
				onClick={onDisconnect}
				size="sm"
				type="button"
				variant="outline"
			>
				{pending ? "Disconnecting…" : "Disconnect"}
			</Button>
		</div>
	);
}

function SectionSkeleton() {
	return (
		<div className="flex max-w-lg flex-col gap-3">
			<Skeleton className="h-4 w-3/4" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-32" />
		</div>
	);
}

export function GithubConnectionSection() {
	const status = useQuery(orpc.github.status.queryOptions());
	// The login is only known from this session's connect response — the
	// server intentionally stores nothing but the encrypted token + last4.
	const [login, setLogin] = useState<string | null>(null);
	const connect = useConnect(setLogin);
	const disconnect = useDisconnect(() => setLogin(null));

	return (
		<div className="flex flex-col gap-3">
			<h2 className="font-medium text-lg">GitHub</h2>
			<GithubSectionBody
				connectPending={connect.isPending}
				disconnectPending={disconnect.isPending}
				isPending={status.isPending}
				login={login}
				onConnect={(token) => connect.mutate({ token })}
				onDisconnect={() => disconnect.mutate({})}
				status={status.data}
			/>
		</div>
	);
}

function GithubSectionBody({
	isPending,
	status,
	login,
	connectPending,
	disconnectPending,
	onConnect,
	onDisconnect,
}: {
	isPending: boolean;
	status: { connected: boolean; tokenLast4?: string } | undefined;
	login: string | null;
	connectPending: boolean;
	disconnectPending: boolean;
	onConnect: (token: string) => void;
	onDisconnect: () => void;
}) {
	if (isPending) {
		return <SectionSkeleton />;
	}
	if (status?.connected) {
		return (
			<ConnectedCard
				login={login}
				onDisconnect={onDisconnect}
				pending={disconnectPending}
				tokenLast4={status.tokenLast4}
			/>
		);
	}
	return <ConnectForm onSubmit={onConnect} pending={connectPending} />;
}
