import {
	SidebarInset,
	SidebarProvider,
} from "@better-agent/ui/components/sidebar";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { useImmersiveChat } from "@/components/layout/use-immersive-chat";
import { RocketLoader } from "@/components/rocket-loader";
import { RouteProgress } from "@/components/route-progress";
import { RouteTransition } from "@/components/route-transition";
import { WebSidebar } from "@/components/sidebar";
import { getAccessToken, loadRefreshToken, setTokens } from "@/utils/auth";
import { client, orpc } from "@/utils/orpc";

const PUBLIC_PATHS = [
	"/login",
	"/auth/verify",
	"/auth/google/callback",
	"/reset-password",
];

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

function AuthedShell() {
	// An open conversation (<md) is immersive: the dock is suppressed AND its
	// reserved bottom padding is dropped so the chat uses the full viewport with
	// no blank strip. This predicate is static per route (pathname + search) —
	// never reactive to the dock's hidden state — so it can't reintroduce the
	// scroll/padding oscillation that commit 1d89402 removed.
	const immersive = useImmersiveChat();
	return (
		<SidebarProvider className="h-svh overflow-hidden">
			<WebSidebar />
			<SidebarInset className="min-h-0 min-w-0 overflow-hidden">
				{/* No mobile top bar: the floating dock's "More" tab opens the
				    sidebar drawer, so a header with a hamburger + app name would
				    just eat vertical space. Verify-email banner hidden for now.
				    Bottom padding is CONSTANT per route (never toggled by the dock)
				    so the dock hiding can't reflow the scroll area and oscillate. */}
				<div
					className={cn(
						"flex min-h-0 flex-1 flex-col overflow-auto md:pb-0",
						immersive ? "pb-0" : "pb-tab-bar"
					)}
				>
					<RouteTransition>
						<Outlet />
					</RouteTransition>
				</div>
			</SidebarInset>
			<MobileTabBar />
		</SidebarProvider>
	);
}

function LoadingScreen() {
	return (
		<div className="flex h-svh items-center justify-center">
			<RocketLoader />
		</div>
	);
}

function StandaloneOutlet() {
	return (
		<main className="flex min-h-svh flex-col">
			<Outlet />
		</main>
	);
}

function BoundaryContent({
	authed,
	isPublic,
	isInvite,
	ready,
	inviteChecked,
	blocked,
}: {
	authed: boolean;
	isPublic: boolean;
	isInvite: boolean;
	ready: boolean;
	inviteChecked: boolean;
	blocked: boolean;
}) {
	if (isPublic) {
		return <StandaloneOutlet />;
	}
	if (!(ready && authed)) {
		return <LoadingScreen />;
	}
	if (isInvite) {
		return <StandaloneOutlet />;
	}
	// Wait for the invite check, and hold while redirecting a blocked user.
	if (!inviteChecked || blocked) {
		return <LoadingScreen />;
	}
	return <AuthedShell />;
}

export function AuthBoundary() {
	const ready = useAuthBootstrap();
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
	const isInvite = pathname.startsWith("/invite");
	// Read live each render: after /auth/verify calls setTokens, this becomes
	// non-null on the next render, so the just-signed-in user isn't redirected.
	const authed = getAccessToken() !== null;

	const inviteStatus = useQuery({
		...orpc.invite.status.queryOptions(),
		enabled: ready && authed && !isPublic,
	});
	const blocked = inviteStatus.data
		? inviteStatus.data.required && !inviteStatus.data.authorized
		: false;

	useEffect(() => {
		if (!isPublic && ready && !authed) {
			navigate({ to: "/login" });
			return;
		}
		if (!(isPublic || isInvite) && ready && authed && blocked) {
			navigate({ to: "/invite" });
		}
	}, [isPublic, isInvite, ready, authed, blocked, navigate]);

	return (
		<>
			<RouteProgress active={!(ready && (isPublic || inviteStatus.data))} />
			<BoundaryContent
				authed={authed}
				blocked={blocked}
				inviteChecked={Boolean(inviteStatus.data)}
				isInvite={isInvite}
				isPublic={isPublic}
				ready={ready}
			/>
		</>
	);
}
