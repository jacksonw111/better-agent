import { createContext, type ReactNode, useContext } from "react";
import { cn } from "./lib/cn";

/** Props every PdfLink implementation receives. The finance report/research
 * cards render `<PdfLink pdfUrl title label className/>`; a host app decides
 * what clicking does (e.g. open a vault drawer). */
export interface PdfLinkProps {
	className?: string;
	label?: string;
	pdfUrl: string;
	title?: string;
}

export type PdfLinkComponent = (props: PdfLinkProps) => ReactNode;

/** The package's standalone default: a plain external link. A host app that
 * wants richer behaviour (a drawer, analytics, prefetch) supplies its own
 * component via `PdfLinkProvider`. */
function DefaultPdfLink({ pdfUrl, label, className }: PdfLinkProps): ReactNode {
	return (
		<a
			className={cn(
				"inline-flex w-fit items-center gap-1 text-primary text-xs hover:underline",
				className
			)}
			href={pdfUrl}
			rel="noopener"
			target="_blank"
		>
			{label ?? "PDF"}
		</a>
	);
}

const PdfLinkContext = createContext<PdfLinkComponent>(DefaultPdfLink);

/** Supply the host app's PdfLink implementation to every finance card rendered
 * inside. Without a provider, cards fall back to `DefaultPdfLink`. */
export function PdfLinkProvider({
	value,
	children,
}: {
	children: ReactNode;
	value: PdfLinkComponent;
}) {
	return (
		<PdfLinkContext.Provider value={value}>{children}</PdfLinkContext.Provider>
	);
}

/** The PDF affordance the finance report/research cards render. Delegates to
 * whatever component the nearest `PdfLinkProvider` supplied (default: a plain
 * external link). */
export function PdfLink(props: PdfLinkProps): ReactNode {
	const Component = useContext(PdfLinkContext);
	return <Component {...props} />;
}
