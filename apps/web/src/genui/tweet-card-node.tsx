import { Repeat2, X as XLogo } from "lucide-react";
import {
	EmbeddedTweet,
	ExpandableText,
	TweetIdentity,
	TweetMedia,
	TweetStats,
} from "./embedded-tweet-node";
import type { NormalizedTweetData } from "./x-result-schemas";

/** A tweet from the X MCP tools' `NormalizedTweet` shape (see
 * apps/mcp/src/x/x-types.ts) — plain data, rendered directly (no agent-authored
 * UI tree involved). */
export type TweetCardTweet = NormalizedTweetData;

/** "🔁 @author reposted" line above the embedded original of a retweet. */
function RepostHeader({ screenName }: { screenName: string }) {
	const who = screenName ? `@${screenName}` : "Someone";
	return (
		<div className="flex items-center gap-2 text-muted-foreground text-xs">
			<Repeat2 className="size-3.5" />
			<span className="truncate">{who} reposted</span>
		</div>
	);
}

/** A retweet renders the reposter's repost line above the source tweet; there is
 * no body of its own (the RT text is just "RT @author: …"). */
function RetweetCard({ tweet }: { tweet: NormalizedTweetData }) {
	const source = tweet.retweetedTweet;
	if (!source) {
		return <ExpandableText text={tweet.fullText} />;
	}
	return (
		<div className="flex flex-col gap-2">
			<RepostHeader screenName={tweet.authorScreenName} />
			<EmbeddedTweet tweet={source} />
		</div>
	);
}

function OriginalBody({ tweet }: { tweet: NormalizedTweetData }) {
	return (
		<div className="flex flex-col gap-2">
			{tweet.fullText ? <ExpandableText text={tweet.fullText} /> : null}
			<TweetMedia media={tweet.media} />
			{tweet.quotedTweet ? <EmbeddedTweet tweet={tweet.quotedTweet} /> : null}
		</div>
	);
}

/** Render a real X tweet (from the tool-result registry) as a rich card. */
export function TweetCardFromTweet({ tweet }: { tweet: TweetCardTweet }) {
	const url = `https://x.com/${tweet.authorScreenName}/status/${tweet.tweetId}`;
	const isRetweet = tweet.kind === "retweet" && tweet.retweetedTweet !== null;
	return (
		<a
			className="block w-full max-w-md no-underline"
			href={url}
			rel="noopener noreferrer"
			target="_blank"
		>
			<div className="flex w-full max-w-md flex-col gap-3 rounded-md bg-muted/40 p-4">
				<div className="flex items-start justify-between gap-2">
					<TweetIdentity
						authorAvatarUrl={tweet.authorAvatarUrl}
						authorName={tweet.authorName}
						authorScreenName={tweet.authorScreenName}
						postedAt={tweet.postedAt}
					/>
					<XLogo className="size-4 shrink-0 text-muted-foreground" />
				</div>
				{isRetweet ? (
					<RetweetCard tweet={tweet} />
				) : (
					<OriginalBody tweet={tweet} />
				)}
				<TweetStats
					likeCount={tweet.likeCount}
					replyCount={tweet.replyCount}
					retweetCount={tweet.retweetCount}
					viewCount={tweet.viewCount}
				/>
			</div>
		</a>
	);
}
