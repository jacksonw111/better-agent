import { useState } from "react";
import { documentContentUrl } from "../content-url";
import type { KnowledgeDocument } from "../knowledge-types";
import { DownloadFallback } from "./preview-chrome";

/** Images stream progressively off the content route — no size cap, the
 * browser decodes incrementally. */
export default function ImagePreview({ doc }: { doc: KnowledgeDocument }) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	return (
		<div className="flex justify-center p-4">
			{/* biome-ignore lint/correctness/useImageSize: intrinsic dimensions are unknown until the uploaded file loads */}
			{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is a load-failure handler, not an interaction */}
			<img
				alt={doc.name}
				className="max-w-full rounded-lg"
				onError={() => setFailed(true)}
				src={documentContentUrl(doc.id)}
			/>
		</div>
	);
}
