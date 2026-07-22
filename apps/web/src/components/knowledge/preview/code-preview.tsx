import { useQuery } from "@tanstack/react-query";
import type { HighlighterCore } from "shiki/core";
import type { KnowledgeDocument } from "../knowledge-types";
import { LANG_BY_EXT, LANG_LOADERS } from "./code-langs";
import { fetchDocumentText } from "./fetch-bytes";
import { DownloadFallback, PreviewSkeleton } from "./preview-chrome";

// Text/code preview: shiki highlights up to HIGHLIGHT_LIMIT; bigger files
// render as plain text (instant, zero parse cost). The highlighter core and
// each grammar are their own lazy chunks — nothing ships with the app shell.

const HIGHLIGHT_LIMIT_BYTES = 512 * 1024;

let corePromise: Promise<HighlighterCore> | null = null;

function loadCore(): Promise<HighlighterCore> {
	corePromise ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
			await Promise.all([
				import("shiki/core"),
				import("shiki/engine/javascript"),
			]);
		return await createHighlighterCore({
			themes: [
				import("shiki/themes/github-light.mjs"),
				import("shiki/themes/github-dark.mjs"),
			],
			langs: [],
			engine: createJavaScriptRegexEngine({ forgiving: true }),
		});
	})();
	return corePromise;
}

/** null = language unknown/unloadable → caller renders plain text. */
async function highlight(code: string, ext: string): Promise<string | null> {
	const lang = LANG_BY_EXT[ext];
	const loader = lang ? LANG_LOADERS[lang] : undefined;
	if (!(lang && loader)) {
		return null;
	}
	try {
		const core = await loadCore();
		if (!core.getLoadedLanguages().includes(lang)) {
			await core.loadLanguage(
				(await loader()) as Parameters<HighlighterCore["loadLanguage"]>[0]
			);
		}
		return core.codeToHtml(code, {
			lang,
			themes: { light: "github-light", dark: "github-dark" },
		});
	} catch {
		return null;
	}
}

function fileExt(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function PlainText({ text }: { text: string }) {
	return (
		<pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">
			{text}
		</pre>
	);
}

export default function CodePreview({ doc }: { doc: KnowledgeDocument }) {
	const preview = useQuery({
		queryKey: ["knowledge-code-preview", doc.id],
		queryFn: async () => {
			const text = await fetchDocumentText(doc.id);
			if (doc.size > HIGHLIGHT_LIMIT_BYTES) {
				return { text, html: null };
			}
			return { text, html: await highlight(text, fileExt(doc.name)) };
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (preview.isPending) {
		return <PreviewSkeleton />;
	}
	if (preview.isError) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	if (preview.data.html === null) {
		return <PlainText text={preview.data.text} />;
	}
	return (
		<div
			className="knowledge-code-preview overflow-auto p-4 font-mono text-sm"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is generated markup over escaped code, never raw user HTML
			dangerouslySetInnerHTML={{ __html: preview.data.html }}
		/>
	);
}
