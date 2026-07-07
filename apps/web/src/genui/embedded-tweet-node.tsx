"use client";

import { cn } from "@better-agent/ui/lib/utils";
import {
	BarChart3,
	Heart,
	type LucideIcon,
	MessageCircle,
	Repeat2,
} from "lucide-react";
import { useState } from "react";
import type {
	EmbeddedTweetData,
	NormalizedMediaData,
} from "./x-result-schemas";

const KILO = 1000;
const MEGA = 1_000_000;
const DECIMAL_ROUND = 10;
const MAX_MEDIA = 4;
const SINGLE_MEDIA = 1;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const RECENT_DAYS_WINDOW = 7;
const LONG_TEXT_THRESHOLD = 280;

const RELATIVE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
});

function trimDecimal(v: number): string {
	const rounded = Math.round(v * DECIMAL_ROUND) / DECIMAL_ROUND;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function compactNumber(n: number): string {
	if (n < KILO) {
		return String(n);
	}
	if (n < MEGA) {
		return `${trimDecimal(n / KILO)}K`;
	}
	return `${trimDecimal(n / MEGA)}M`;
}

function relativeTime(iso: string): string {
	if (!iso) {
		return "";
	}
	const date = new Date(iso);
	const elapsedMs = Date.now() - date.getTime();
	if (Number.isNaN(elapsedMs)) {
		return "";
	}
	const seconds = Math.floor(elapsedMs / MS_PER_SECOND);
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
	const hours = Math.floor(minutes / MINUTES_PER_HOUR);
	const days = Math.floor(hours / HOURS_PER_DAY);
	if (minutes < 1) {
		return "now";
	}
	if (hours < 1) {
		return `${minutes}m`;
	}
	if (days < 1) {
		return `${hours}h`;
	}
	if (days < RECENT_DAYS_WINDOW) {
		return `${days}d`;
	}
	return RELATIVE_DATE_FORMAT.format(date);
}

export function AuthorAvatar({
	name,
	url,
	small,
}: {
	name: string;
	url: string;
	small?: boolean;
}) {
	const sizeClass = small ? "size-6" : "size-10";
	if (url) {
		return (
			// biome-ignore lint/correctness/useImageSize: remote avatar, size set via className
			<img
				alt={`${name || "user"} avatar`}
				className={cn(sizeClass, "shrink-0 rounded-full object-cover")}
				src={url}
			/>
		);
	}
	const initial = name.charAt(0).toUpperCase() || "?";
	return (
		<div
			className={cn(
				sizeClass,
				"flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs"
			)}
		>
			{initial}
		</div>
	);
}

/** Avatar + display name + @handle + relative time, one row. */
export function TweetIdentity({
	authorAvatarUrl,
	authorName,
	authorScreenName,
	postedAt,
	small,
}: {
	authorAvatarUrl: string | null;
	authorName: string;
	authorScreenName: string;
	postedAt: string;
	small?: boolean;
}) {
	const relative = relativeTime(postedAt);
	const displayName = authorName || authorScreenName;
	return (
		<div className="flex min-w-0 items-center gap-2">
			<AuthorAvatar
				name={displayName}
				small={small}
				url={authorAvatarUrl ?? ""}
			/>
			<div className="flex min-w-0 flex-wrap items-center gap-x-1">
				<span className="truncate font-semibold text-sm">{displayName}</span>
				<span className="truncate text-muted-foreground text-xs">
					@{authorScreenName}
					{relative ? ` · ${relative}` : ""}
				</span>
			</div>
		</div>
	);
}

function MediaVideo({ src }: { src: string }) {
	return (
		// biome-ignore lint/a11y/useMediaCaption: scraped tweet media has no caption track
		<video
			className="max-h-72 w-full rounded-lg border object-cover"
			controls
			src={src}
		/>
	);
}

function MediaImage({ src, className }: { src: string; className: string }) {
	return (
		// biome-ignore lint/correctness/useImageSize: remote tweet media, size set via className
		<img alt="Attached to tweet" className={className} src={src} />
	);
}

export function TweetMedia({ media }: { media: NormalizedMediaData[] }) {
	const items = [...media]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.slice(0, MAX_MEDIA);
	const first = items[0];
	if (!first) {
		return null;
	}
	if (
		items.length === SINGLE_MEDIA &&
		(first.kind === "video" || first.kind === "gif")
	) {
		return <MediaVideo src={first.url} />;
	}
	if (items.length === SINGLE_MEDIA) {
		return (
			<MediaImage
				className="max-h-72 w-full rounded-lg border object-cover"
				src={first.url}
			/>
		);
	}
	return (
		<div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-lg border">
			{items.map((m) => (
				<MediaImage
					className="aspect-square w-full object-cover"
					key={m.url}
					src={m.url}
				/>
			))}
		</div>
	);
}

/** Long-form (note) tweets are clamped with a keyboard-focusable expand. */
export function ExpandableText({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	if (text.length <= LONG_TEXT_THRESHOLD) {
		return <p className="whitespace-pre-wrap break-words text-sm">{text}</p>;
	}
	const shown = expanded
		? text
		: `${text.slice(0, LONG_TEXT_THRESHOLD).trimEnd()}…`;
	return (
		<div className="flex flex-col gap-1">
			<p className="whitespace-pre-wrap break-words text-sm">{shown}</p>
			<button
				className="self-start font-medium text-primary text-xs hover:underline"
				onClick={(e) => {
					e.preventDefault();
					setExpanded((v) => !v);
				}}
				type="button"
			>
				{expanded ? "Show less" : "Show more"}
			</button>
		</div>
	);
}

function StatItem({ icon: Icon, value }: { icon: LucideIcon; value: number }) {
	return (
		<span className="flex items-center gap-1">
			<Icon className="size-3.5" />
			{compactNumber(value)}
		</span>
	);
}

export function TweetStats({
	likeCount,
	replyCount,
	retweetCount,
	viewCount,
}: {
	likeCount: number;
	replyCount: number;
	retweetCount: number;
	viewCount: number;
}) {
	return (
		<div className="flex items-center gap-4 text-muted-foreground text-xs">
			<StatItem icon={MessageCircle} value={replyCount} />
			<StatItem icon={Repeat2} value={retweetCount} />
			<StatItem icon={Heart} value={likeCount} />
			<StatItem icon={BarChart3} value={viewCount} />
		</div>
	);
}

/** The source tweet embedded inside a retweet or quote — a quieter, bordered
 * nested card. Reused for both so the two paths never drift. */
export function EmbeddedTweet({ tweet }: { tweet: EmbeddedTweetData }) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
			<TweetIdentity
				authorAvatarUrl={tweet.authorAvatarUrl}
				authorName={tweet.authorName}
				authorScreenName={tweet.authorScreenName}
				postedAt={tweet.postedAt}
				small
			/>
			{tweet.fullText ? (
				<p className="line-clamp-4 whitespace-pre-wrap break-words text-sm">
					{tweet.fullText}
				</p>
			) : null}
			<TweetMedia media={tweet.media} />
		</div>
	);
}
