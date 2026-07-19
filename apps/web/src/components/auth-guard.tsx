import { PixelLoading } from "@better-agent/ui/components/pixel-loading";
import {
	SidebarInset,
	SidebarProvider,
} from "@better-agent/ui/components/sidebar";
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { useImmersiveChat } from "@/components/layout/use-immersive-chat";
import { RouteProgress } from "@/components/route-progress";
import { RouteTransition } from "@/components/route-transition";
import { WebSidebar } from "@/components/sidebar";
import { getAccessToken, loadRefreshToken } from "@/utils/auth";
import { orpc, refreshAccessTokenShared } from "@/utils/orpc";

const PUBLIC_PATHS = [
	"/login",
	"/auth/verify",
	"/auth/google/callback",
	"/reset-password",
];

// Remembers that the LAST bootstrap on this browser authenticated fine — a
// non-sensitive hint (no token material) that lets the next reload render the
// app immediately instead of blocking on the refresh round trip.
const WARM_BOOT_KEY = "ba_warm_boot";

function readWarmBoot(): boolean {
	return (
		typeof localStorage !== "undefined" &&
		localStorage.getItem(WARM_BOOT_KEY) === "1"
	);
}

function writeWarmBoot(on: boolean): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	if (on) {
		localStorage.setItem(WARM_BOOT_KEY, "1");
	} else {
		localStorage.removeItem(WARM_BOOT_KEY);
	}
}

// On load, mint a fresh access token from the stored refresh token before
// deciding whether the user is signed in. Warm boots (this browser authed
// successfully last time) don't wait for that round trip: `optimistic` lets
// the shell render immediately while the refresh runs in the background —
// early queries 401 once and the link interceptor retries them after the
// SAME shared refresh (refreshAccessTokenShared, so rotation can't race).
// A refresh that ultimately fails drops `optimistic` and the redirect-to-login
// effect takes over.
function useAuthBootstrap(): { optimistic: boolean; ready: boolean } {
	const [state, setState] = useState(() => ({
		ready: false,
		optimistic: loadRefreshToken() !== null && readWarmBoot(),
	}));
	useEffect(() => {
		let active = true;
		const settle = () => {
			if (active) {
				setState({ ready: true, optimistic: false });
			}
		};
		if (loadRefreshToken()) {
			refreshAccessTokenShared().then((ok) => {
				writeWarmBoot(ok);
				settle();
			});
		} else {
			writeWarmBoot(false);
			settle();
		}
		return () => {
			active = false;
		};
	}, []);
	return state;
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
			<CommandPalette />
		</SidebarProvider>
	);
}

// The global boot loader. The pixel platformer replaced the RocketLoader
// here by request; the rocket stays alive for route-level waits (chat.tsx).
function LoadingScreen() {
	return (
		<div className="flex h-svh items-center justify-center">
			<PixelLoading label="Loading" />
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
	const { optimistic, ready } = useAuthBootstrap();
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
	const isInvite = pathname.startsWith("/invite");
	// Read live each render: after /auth/verify calls setTokens, this becomes
	// non-null on the next render, so the just-signed-in user isn't redirected.
	// Warm boots count as authed while the background refresh is in flight.
	const authed = getAccessToken() !== null || optimistic;
	// Warm boots render the shell before the round trip settles.
	const settled = ready || optimistic;

	const inviteStatus = useQuery({
		...orpc.invite.status.queryOptions(),
		enabled: settled && authed && !isPublic,
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
				inviteChecked={Boolean(inviteStatus.data) || optimistic}
				isInvite={isInvite}
				isPublic={isPublic}
				ready={settled}
			/>
		</>
	);
}
