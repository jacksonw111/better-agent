import type { ReactNode } from "react";

/**
 * Canonical page shell for list/detail routes: centers content at a shared
 * max width with consistent gutter padding. `title`/`actions` are optional —
 * per the repo's "no boilerplate page-header" convention, only pass a title
 * when the page has real actions to anchor next to it; most routes render
 * their own toolbar/header below and leave both unset.
 */
export function PageContainer({
	actions,
	children,
	title,
}: {
	actions?: ReactNode;
	children: ReactNode;
	title?: string;
}) {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
			{title ? (
				<div className="flex items-center justify-between gap-2">
					<h1 className="font-semibold text-lg">{title}</h1>
					{actions}
				</div>
			) : null}
			{children}
		</div>
	);
}
