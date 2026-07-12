import { BadgeCheck } from "lucide-react";
import { AuthorAvatar, compactNumber } from "./embedded-tweet-node";

/** A profile from the X MCP tools' `NormalizedProfile` shape (see
 * apps/mcp/src/x/x-types.ts). */
export interface UserCardProfile {
	description: string | null;
	displayName: string;
	followersCount: number;
	profileImageUrl: string | null;
	screenName: string;
	verified: boolean;
}

/** Compact user card for X profile results (x_search_users, x_followers,
 * x_following) — visually consistent with TweetCard, styled smaller since a
 * list of these is usually shown together. */
export function UserCard({ profile }: { profile: UserCardProfile }) {
	return (
		<a
			className="block w-full max-w-md no-underline"
			href={`https://x.com/${profile.screenName}`}
			rel="noopener noreferrer"
			target="_blank"
		>
			<div className="flex w-full items-center gap-3 rounded-md border p-3">
				<AuthorAvatar
					name={profile.displayName}
					url={profile.profileImageUrl ?? ""}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1">
						<span className="truncate font-medium text-sm">
							{profile.displayName}
						</span>
						{profile.verified ? (
							<BadgeCheck className="size-4 shrink-0 text-sky-500" />
						) : null}
					</div>
					<div className="truncate text-muted-foreground text-xs">
						@{profile.screenName}
					</div>
					{profile.description ? (
						<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
							{profile.description}
						</p>
					) : null}
				</div>
				<span className="shrink-0 text-muted-foreground text-xs">
					{compactNumber(profile.followersCount)} followers
				</span>
			</div>
		</a>
	);
}
