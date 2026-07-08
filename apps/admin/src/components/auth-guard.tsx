import { Button } from "@better-agent/ui/components/button";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@better-agent/ui/components/sidebar";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { RouteProgress } from "@/components/route-progress";
import { RouteTransition } from "@/components/route-transition";
import { AdminSidebar } from "@/components/sidebar";
import {
	clearTokens,
	getAccessToken,
	loadRefreshToken,
	setTokens,
} from "@/utils/auth";
import { client, orpc } from "@/utils/orpc";

const PUBLIC_PATHS = ["/login", "/auth/verify"];

// On load, mint a fresh access token from the stored refresh token (if any)
// before deciding whether the user is signed in. Returns whether bootstrap
// has finished; sign-in state is read live from getAccessToken().
function useAuthBootstrap(): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		let active = true;
		const refreshToken = loadRefreshToken();
		if (refreshToken) {
			client.auth
				.refresh({ refreshToken })
				.then((result) => setTokens(result))
				.catch(() => {
					// Stored refresh token is invalid/expired; stay signed out.
				})
				.finally(() => {
					if (active) {
						setReady(true);
					}
				});
		} else {
			setReady(true);
		}
		return () => {
			active = false;
		};
	}, []);
	return ready;
}

function LoadingScreen() {
	return (
		<div className="flex h-svh items-center justify-center">
			<Skeleton className="h-8 w-32" />
		</div>
	);
}

function AdminShell() {
	return (
		<SidebarProvider className="h-svh overflow-hidden">
			<AdminSidebar />
			<SidebarInset className="min-h-0 overflow-hidden">
				<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
					<SidebarTrigger />
					<span className="font-medium text-sm">better-agent</span>
				</header>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<RouteTransition>
						<Outlet />
					</RouteTransition>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

function NotAuthorizedScreen({ email }: { email: string | undefined }) {
	const navigate = useNavigate();
	const handleSignOut = async () => {
		const refreshToken = loadRefreshToken();
		if (refreshToken) {
			await client.auth.logout({ refreshToken });
		}
		clearTokens();
		navigate({ to: "/login" });
	};
	return (
		<div className="flex h-svh flex-col items-center justify-center gap-4 p-6 text-center">
			<p className="font-semibold text-lg">Not authorized</p>
			{email ? <p className="text-muted-foreground text-sm">{email}</p> : null}
			<Button onClick={handleSignOut} variant="outline">
				Sign out
			</Button>
		</div>
	);
}

function AuthedContent() {
	const me = useQuery(orpc.auth.me.queryOptions());
	// Only the confirmed-admin path renders the shell: while loading or on a
	// transient error we wait (the query retries) rather than flash the chrome.
	if (me.isPending || me.isError) {
		return <LoadingScreen />;
	}
	if (!me.data.isAdmin) {
		return <NotAuthorizedScreen email={me.data.email} />;
	}
	return (
		<>
			<RouteProgress />
			<AdminShell />
		</>
	);
}

function BoundaryContent({
	authed,
	isPublic,
	ready,
}: {
	authed: boolean;
	isPublic: boolean;
	ready: boolean;
}) {
	if (isPublic) {
		return (
			<main className="flex min-h-svh flex-col">
				<Outlet />
			</main>
		);
	}
	if (!(ready && authed)) {
		return <LoadingScreen />;
	}
	return <AuthedContent />;
}

export function AuthBoundary() {
	const ready = useAuthBootstrap();
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
	// Read live each render: after /auth/verify calls setTokens, this becomes
	// non-null on the next render, so the just-signed-in user isn't redirected.
	const authed = getAccessToken() !== null;
	useEffect(() => {
		if (!isPublic && ready && !authed) {
			navigate({ to: "/login" });
		}
	}, [isPublic, ready, authed, navigate]);
	return (
		<>
			<RouteProgress active={!ready} />
			<BoundaryContent authed={authed} isPublic={isPublic} ready={ready} />
		</>
	);
}
