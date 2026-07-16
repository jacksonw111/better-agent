import {
	BookMarked,
	Bot,
	Gauge,
	Laptop,
	ListTodo,
	Plug,
	Wand2,
} from "lucide-react";

// The authed app's top-level destinations — the single source both the
// sidebar (components/sidebar.tsx) and the ⌘K palette's "Go to" group render
// from, so the two can't drift. Chat is deliberately absent: it's not a
// top-level nav item (you open a chat from an agent row → /chat?agentId=…).
// S3-T3 nav定案: Tasks first, Computers second; the old Local Agents entry is
// retired (/local redirects to /tasks; /local/$tokenId stays direct-link only).
// `as const` keeps each `to` a route-path literal so the palette's typed
// `navigate({ to })` accepts it.
export const WEB_NAV_ITEMS = [
	{ icon: ListTodo, label: "Tasks", to: "/tasks" },
	{ icon: Laptop, label: "Computers", to: "/computers" },
	{ icon: Gauge, label: "Dashboard", to: "/dashboard" },
	{ icon: Bot, label: "Agents", match: ["/chat"], to: "/agents" },
	{ icon: BookMarked, label: "Memories", to: "/memories" },
	{ icon: Wand2, label: "Skills", to: "/skills" },
	{ icon: Plug, label: "Integrations", to: "/integrations" },
] as const;
