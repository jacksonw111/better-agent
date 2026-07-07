export type XTweetKind = "original" | "reply" | "quote" | "retweet";
export type XMediaKind = "photo" | "video" | "gif";

export interface NormalizedMedia {
	bitrate: number | null;
	durationMs: number | null;
	height: number | null;
	kind: XMediaKind;
	sortOrder: number;
	url: string;
	width: number | null;
}

export interface NormalizedTweet {
	authorAvatarUrl: string | null;
	authorName: string;
	authorScreenName: string;
	authorTwitterUserId: string;
	fullText: string;
	kind: XTweetKind;
	lang: string | null;
	likeCount: number;
	media: NormalizedMedia[];
	postedAt: Date;
	quoteCount: number;
	/** The full quoted tweet, embedded one level deep (its own
	 * quotedTweet/retweetedTweet are always null to bound recursion). */
	quotedTweet: NormalizedTweet | null;
	quotedTweetId: string | null;
	replyCount: number;
	replyToScreenName: string | null;
	replyToTweetId: string | null;
	retweetCount: number;
	/** The full reposted tweet, embedded one level deep (its own
	 * quotedTweet/retweetedTweet are always null to bound recursion). */
	retweetedTweet: NormalizedTweet | null;
	retweetedTweetId: string | null;
	tweetId: string;
	viewCount: number;
}

export interface NormalizedProfile {
	bannerUrl: string | null;
	description: string | null;
	displayName: string;
	followersCount: number;
	friendsCount: number;
	location: string | null;
	profileImageUrl: string | null;
	screenName: string;
	statusesCount: number;
	twitterUserId: string;
	verified: boolean;
}
