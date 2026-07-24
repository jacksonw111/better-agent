import {
	BookMarked,
	Bot,
	Gauge,
	Laptop,
	Library,
	Plug,
	UserCog,
	Wand2,
} from "lucide-react";

// The authed app's top-level destinations — the single source both the
// sidebar (components/sidebar.tsx) and the ⌘K palette's "Go to" group render
// from, so the two can't drift. Chat is deliberately absent: it's not a
// top-level nav item (you open a chat from an agent row → /chat?agentId=…).
// Tasks is deliberately absent too: a computer's tasks live on its detail
// page, and the /tasks + /tasks/$taskId routes survive only for those links
// and deep links. The old Local Agents entry stays retired (/local redirects
// to /tasks; /local/$tokenId stays direct-link only). `as const` keeps each
// `to` a route-path literal so the palette's typed `navigate({ to })`
// accepts it.
export const WEB_NAV_ITEMS = [
	{ icon: Gauge, label: "Dashboard", to: "/dashboard" },
	{ icon: Laptop, label: "Computers", to: "/computers" },
	{ icon: Bot, label: "Agents", match: ["/chat"], to: "/agents" },
	{ icon: BookMarked, label: "Memories", to: "/memories" },
	{ icon: Library, label: "Knowledge", to: "/knowledge" },
	// Profile is the umbrella over a user's development spec — standards,
	// templates, skills, MCP — so it sits directly above Skills/Integrations,
	// the two pieces it reuses (see /profile's overview narrative).
	{ icon: UserCog, label: "Profile", to: "/profile" },
	{ icon: Wand2, label: "Skills", to: "/skills" },
	{ icon: Plug, label: "Integrations", to: "/integrations" },
] as const;
