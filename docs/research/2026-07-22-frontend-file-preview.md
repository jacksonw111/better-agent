# Frontend multi-format file preview — library research & architecture

Date: 2026-07-22
Scope: in-browser preview for the Knowledge Base surface (`apps/web`) — PDF, EPUB, MOBI, images, text/code, .docx, .xlsx, CSV — evaluated against primary sources only (npm registry metadata via `npm view`, GitHub repo API / raw source, official docs sites, the SheetJS CDN itself). All sizes below are **minified, uncompressed** bytes measured by downloading the actual dist file from the package's CDN copy on 2026-07-22.

## Executive summary

| Format | Library | License | Bundle cost (min) | Lazy-load strategy | Security notes |
|---|---|---|---|---|---|
| PDF | `react-pdf` 10.4.1 (already installed; pdfjs-dist 5.4.296) | MIT | already paid; lazy | existing `usePdfModule` dynamic import | self-host the pdf.js worker instead of unpkg (see §1) |
| EPUB | `epubjs` 0.3.93 + `react-reader` 2.0.15 | BSD-2-Clause / repo Apache-2.0 (npm meta says ISC) | 224 KB + jszip 98 KB (+wrapper 130 KB unpacked) | `useEpubModule` hook, same pattern as PDF | epub.js iframes chapters with `sandbox="allow-same-origin"` and **no** `allow-scripts` by default — never set `allowScriptedContent` |
| MOBI | **none — download fallback** | — | — | — | only credible JS parser (foliate-js) is not officially on npm; the npm package of that name is a third-party republish |
| Images | native `<img>` (current code) | — | 0 | n/a | already streams off the authed route; TIFF/HEIC → download fallback |
| Text/code | `shiki` 4.3.1, fine-grained bundle + JS regex engine | MIT | core ~small; per-language chunks loaded on demand | `shiki/core` + dynamic `@shikijs/langs-*` imports | output is escaped HTML from a trusted generator; safe to inject |
| DOCX | `docx-preview` 0.4.0 (+ jszip) | Apache-2.0 | 75 KB + jszip 98 KB | dynamic import | **set `renderAltChunks: false`** (embedded-HTML parts are on by default); prefer the sandboxed-viewer-iframe host (§6) |
| XLSX | SheetJS CE **0.20.3 from cdn.sheetjs.com tarball** — never `xlsx` from npm | Apache-2.0 | 952 KB (xlsx.full.min; ESM import is what Vite bundles) | dynamic import; parse in a Web Worker for big files | npm `xlsx@0.18.5` has two CVEs with **no patched version on npm** |
| CSV | `papaparse` 5.5.4 + `@tanstack/react-virtual` 3.14.7 | MIT / MIT | 19 KB + ~52 KB unpacked | dynamic import; `worker: true` for large files | none beyond memory caps |

Licensing red flags, up front:

1. **npm `xlsx` is a trap.** `dist-tags.latest` on npm is 0.18.5, published **2022-03-24** (registry metadata). SheetJS distributes current builds only from `https://cdn.sheetjs.com/` — the official CDN serves `xlsx-latest/package/package.json` = `xlsx 0.20.3 Apache-2.0` (verified directly). GitHub Security Advisories for the npm `xlsx` package list **CVE-2023-30533 (prototype pollution)** and **CVE-2024-22363 (ReDoS)** with `patched_versions: None` **on npm** — the fixes (0.19.3 / 0.20.2) only exist on the CDN ([advisory API](https://api.github.com/advisories?ecosystem=npm&affects=xlsx)). Pin the tarball URL: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. License is Apache-2.0 (CDN package.json + [repo README](https://github.com/SheetJS/sheetjs): "All rights not explicitly granted by the Apache 2.0 License are reserved by the Original Author").
2. **foliate-js on npm is not foliate-js.** The [real repo](https://github.com/johnfactotum/foliate-js) is **MIT** (GitHub API `license.spdx_id: MIT` — the GPL-3.0 license belongs to the Foliate GTK *app*, not this library) and its README says "since there's no release yet, it is recommended that you include the library as a git submodule". The npm package `foliate-js@1.0.1` is published by an unrelated individual (`npm view foliate-js maintainers` → `shmandadi <saiprakash.mandadi@skillsoft.com>`). Do not install it — supply-chain risk.
3. Everything actually recommended is MIT / BSD-2 / Apache-2.0. No GPL anywhere in the recommended set.

---

## 1. PDF — current state (no new work needed)

- `react-pdf@^10.4.1` is a direct dep of `apps/web` and is the npm latest (10.4.1, peer `react ^16.8–^19`, dep `pdfjs-dist 5.4.296` — registry metadata). React 19 is explicitly in the peer range.
- Already lazily loaded via `apps/web/src/components/pdf/use-pdf-module.ts` and streams straight off the authed content route (`documentContentUrl`) — this is the template for every other viewer.
- One improvement worth making: `use-pdf-module.ts:45` sets `workerSrc` to **unpkg.com at runtime**. That is a third-party runtime dependency (availability + supply-chain: the worker parses untrusted PDF bytes). Vite can self-host it: `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"` inside the same dynamic module, keeping it out of the shell bundle.

## 2. EPUB

**epub.js** ([futurepress/epub.js](https://github.com/futurepress/epub.js)):

- Maintenance: last npm release **0.3.93 on 2022-02-16** (`npm view epubjs time`); repo still gets pushes (GitHub API `pushed_at: 2026-03-24`) but 517 open issues and no release in 4+ years. License: npm metadata `BSD-2-Clause` (repo license file shows as NOASSERTION to GitHub's detector — it's the FreeBSD text).
- Size: `dist/epub.min.js` = **223,875 B**; runtime deps include `jszip` (97,630 B min), localforage, lodash, @xmldom/xmldom (`npm view epubjs dependencies`) — real cost is ~400 KB+ min in a Vite bundle. Acceptable as a lazy chunk.
- **How it renders chapters** (verified in [`src/managers/views/iframe.js`](https://github.com/futurepress/epub.js/blob/master/src/managers/views/iframe.js)): each spine section goes into an iframe with `this.iframe.sandbox = "allow-same-origin"`, and `allow-scripts` is appended **only** `if (this.settings.allowScriptedContent)` (`allow-popups` likewise). Content is injected via `srcdoc` by default (blob-URL and `document.write` fallbacks).
- Security read: with the default settings the sandbox has `allow-same-origin` but **not** `allow-scripts`, so `<script>` inside EPUB XHTML cannot execute even though the document is same-origin. epub.js needs same-origin to inject its own styles/annotation hooks into the chapter document, so this cannot be tightened further without forking. Rule: **never pass `allowScriptedContent: true`** — that would combine `allow-scripts` + `allow-same-origin`, i.e. full XSS in the app origin from an uploaded book.
- **react-reader** ([gerhardsletten/react-reader](https://github.com/gerhardsletten/react-reader)): official-style wrapper, "a react-wrapper for epub.js — an iframe based epub-reader" (README). npm 2.0.15, published 2025-09; repo pushed 2026-06. Accepts a `url` prop (our authed content URL works; it's fetched via HTTP, so the `?access_token=` URL is fine) plus `epubOptions` passed to the rendition — the README's own examples show `allowScriptedContent` there, so code-review-guard that option. License discrepancy worth noting: npm metadata says **ISC**, the repo license file is **Apache-2.0**; both are permissive.
- Alternative if epub.js staleness bites: **foliate-js** (MIT, actively developed, `pushed_at: 2026-05-01`), which supports EPUB/MOBI/KF8/FB2/CBZ, renders via blob-URL iframes and its README explicitly warns "Do NOT use this library without CSP unless you completely trust the content you're rendering" ([README](https://github.com/johnfactotum/foliate-js)). It must be vendored as a git submodule (no official npm release). Reasonable v2 upgrade; not the v1 path.

**Recommendation:** epub.js + react-reader, dynamically imported, `allowScriptedContent` never set, size cap ~50 MB (epub.js loads the zip via jszip in memory).

## 3. MOBI — the honest answer: download fallback

What exists, verified:

- **foliate-js** is the only maintained pure-JS MOBI/KF8 (AZW3) parser of note (format list straight from its README). MIT-licensed (good), but *not published to npm by its author* (README recommends git submodule; the `foliate-js` npm name is squatted by a third party — see red flag #2). Using it means vendoring an unversioned dependency and building a custom reader UI on its low-level API.
- No other credible npm MOBI parser surfaced against primary sources; the format is Palm-database-wrapped HTML (MOBI 6) or KF8, and nothing with meaningful adoption parses it in-browser.
- Server-side conversion (Calibre `ebook-convert`, GPLv3 — fine to *run* server-side, but a huge Docker payload) is not worth it for a preview feature.

**Recommendation:** MOBI ships as `DownloadFallback` ("Preview isn't available for this file type") in v1. If MOBI demand materializes, vendor foliate-js's `mobi.js` as a git submodule and render extracted HTML through the sandboxed-viewer-iframe host (§6) — its parser is standalone and MIT.

## 4. Images

- Current native `<img src={documentContentUrl(...)}>` already covers JPEG/PNG/GIF/WebP/AVIF/SVG/BMP with progressive streaming and an error→download fallback (`document-preview.tsx`). Keep it. (SVG via `<img>` is inert — scripts don't run in image decoding context — so the existing path is already safe for SVG.)
- **TIFF:** per [MDN's image format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types), "Other than Safari, browsers do not natively support TIFF images in web content". The JS decoder option (`utif`, MIT) last shipped 2022. Not worth it → download fallback.
- **HEIC/HEIF:** not even listed as a web image format in MDN's guide; no Chromium/Firefox `<img>` support. `heic2any` is a 2.7 MB wasm-wrapper last published 2021 (registry metadata). Not worth it client-side → download fallback. (If ever needed: the server workspace already allowlists `sharp` builds in `pnpm-workspace.yaml` — server-side HEIC→JPEG on upload is the better lever.)

## 5. Text & code with syntax highlighting

Repo reality check first: **shiki is not in the workspace** — `grep -c shiki pnpm-lock.yaml` = 0. `packages/ui/src/components/response.tsx` passes a `shikiTheme` prop to `streamdown@2.5.0`, but streamdown's dependency list contains no shiki and its installed dist chunks are 4–68 KB with no bundled highlighter — the prop name is inherited API surface, not an installed highlighter. So any of the three candidates is a genuinely new dependency.

| | shiki 4.3.1 | highlight.js 11.11.1 | prismjs 1.30.0 |
|---|---|---|---|
| License | MIT | BSD-3-Clause | MIT |
| Last publish | 2026-07 | 2025-08 (metadata mod) | 2025-03 (1.30.0; prior release 1.29.0 was 2022-08; v2 never shipped) |
| Lazy story | first-class: `shiki/core` + per-language `@shikijs/langs` dynamic imports; docs explicitly say avoid `shiki`/`bundle/full` and use the **JavaScript RegExp engine** for "smaller bundle size and faster startup" ([shiki.style/guide/best-performance](https://shiki.style/guide/best-performance)) | per-language `highlight.js/lib/languages/*` imports | plugins/Babel-plugin era; weakest |
| Auto-detection | none — needs an extension→lang map | `highlightAuto()` content-based | none |
| React 19 | framework-agnostic (returns HTML/hast) | agnostic | agnostic |

**Recommendation:** shiki fine-grained bundle (`createHighlighterCore` + JS engine + `github-light`/`github-dark` to match the existing streamdown theming), loaded in a `useShikiModule`-style hook. Language selection from a static extension→lang map (`ts`, `tsx`, `py`, `rs`, `go`, `json`, `yaml`, `md`, `sh`, …); unknown extensions fall back to the existing plain `<pre>`. Shiki escapes code into HTML itself — the input is displayed-as-text, not executed, so no sanitization concern. Keep the existing 5 MB text cap; skip highlighting above ~500 KB (tokenizing megabytes of minified JS will jank) and render plain.

## 6. Word (.docx)

Two viable libraries, both verified:

**mammoth.js** ([mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js)) — npm 1.12.0 (2026-03), BSD-2-Clause, active (repo pushed 2026-05). Converts docx→**semantic** HTML; README is explicit that "the conversion is unlikely to be perfect for more complicated documents" (no page layout, no table borders, styles mapped to tags). Browser build `mammoth.browser.min.js` = **635,882 B**; input `{arrayBuffer}`; images become base64 `<img>` by default. Critical, from its own README: "**Mammoth performs no sanitisation of the source document, and should therefore be used extremely carefully with untrusted user input**" (risks include JavaScript links). So its HTML output requires DOMPurify (or rehype-sanitize, already in the tree via streamdown's deps) before injection.

**docx-preview** ([VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)) — npm 0.4.0 published 2026-07-07, Apache-2.0, actively released (repo pushed same day). Renders docx into a container as HTML/CSS approximating Word layout (pages, columns) — much closer visual fidelity than mammoth for a *preview* use case. Dist = **75,297 B** + jszip (98 KB, shared with epub.js chunk). API: `renderAsync(blob|ArrayBuffer, container, styleContainer, options)`. Caveats from its README: only `renderAsync` is a stable API; and — security-relevant — **`renderAltChunks` defaults to `true`**, which renders embedded raw-HTML parts (`altChunk`) from inside the docx. An attacker-crafted docx can carry arbitrary HTML that way.

**Recommendation:** `docx-preview` for fidelity and active maintenance, with `renderAltChunks: false` mandatory. Because both libraries ultimately build DOM from attacker-controlled XML in the app origin, the belt-and-braces posture the team's constraint implies is to host the whole docx renderer inside the sandboxed-viewer iframe pattern:

> **Sandboxed-viewer-iframe host (reusable for every HTML-producing format):** ship a tiny self-contained viewer page as a static Vite asset, load it in `<iframe sandbox="allow-scripts">` (crucially **without** `allow-same-origin` → opaque origin), and pass the file's `ArrayBuffer` in via `postMessage`. The viewer chunk (docx-preview + jszip) runs and renders *inside* the null-origin frame; even a successful HTML/JS injection lands in an origin with no cookies, no localStorage, no access token, and no reach back into the app DOM. This is the only pattern that fully satisfies "user HTML must never execute in the app origin" while still executing a renderer.

If that's judged too much machinery for v1, the acceptable middle ground is docx-preview directly in the drawer with `renderAltChunks: false` — the residual risk is a parser bug, not a by-design HTML pass-through. Size cap ~10 MB.

## 7. Excel (.xlsx)

**SheetJS CE** — see red flag #1 for the distribution/licensing situation (npm frozen at 0.18.5/2022 with two npm-unpatched CVEs; current 0.20.3 Apache-2.0 only via `cdn.sheetjs.com` tarball, verified against the CDN's own `package.json`). pnpm handles tarball-URL dependencies and pins integrity in the lockfile; the URL can't live in a catalog range but works as a direct dependency specifier.

**exceljs** ([exceljs/exceljs](https://github.com/exceljs/exceljs)) — MIT, but last release 4.4.0 (2023; npm metadata last touched 2024-12), repo last pushed **2025-01**, 795 open issues, browser bundle **947,702 B**, and its streaming reader is Node-only. Effectively dormant; rejected.

Rendering strategy: `XLSX.read(arrayBuffer)` → `sheet_to_json(sheet, { header: 1 })` per sheet → own React table (sheet tabs + virtualized rows via `@tanstack/react-virtual`, shared with CSV). No canvas grid lib — the preview goal is "see the data", not editing; a canvas grid (e.g. glide-data-grid) adds ~1 MB+ and worker complexity for no preview benefit. For files >~5 MB, run `XLSX.read` inside a Web Worker (it's synchronous and will block the main thread). Cap ~20 MB and cap rendered cells (e.g. first 10k rows per sheet, with a "showing first N rows" notice). XLSX output is plain strings/numbers into React text nodes — no HTML injection surface as long as cells are never `dangerouslySetInnerHTML`'d.

## 8. CSV

**papaparse 5.5.4** ([mholt/PapaParse](https://github.com/mholt/PapaParse), docs at [papaparse.com/docs](https://www.papaparse.com/docs)) — MIT, active (npm 2026-06, repo pushed 2026-07), **19,476 B** min. Verified from its docs: `worker: true` keeps the page reactive; `step`/`chunk` callbacks stream large inputs (default 10 MB local-file chunks, configurable); `header: true` with duplicate-header renaming; `dynamicTyping` with >2^53 precision guard. Parse the streamed `File`/`Blob` from the existing oRPC `knowledgeBase.download` (same call `TextPreview` uses) or fetch the content URL.

Rendering: same virtualized table component as XLSX. **`@tanstack/react-virtual` is not currently in the workspace** (zero lockfile hits) — it's a new but tiny dep (3.14.7, MIT, 52 KB unpacked, actively released 2026-07) and stays in the TanStack family already used everywhere in `apps/web` (query/router). Caps: parse with `preview: 10_000` rows for the first paint, "load more" re-parses with a higher preview; hard cap ~100 MB via worker+chunking, or simply 25 MB in v1.

## 9. Cross-cutting: detection, caps, chunking, registry architecture

### File-type detection

- The stored `mime` is **client-declared**: `use-document-upload.ts:85` sends `file.type || "application/octet-stream"`. Browsers derive `file.type` from OS extension mappings — `.mobi` and often `.md` arrive as empty → `application/octet-stream`, and a hostile client can claim anything. So:
  - The preview registry must match on **mime OR filename extension** (extension rescues the octet-stream cases; the drawer already has `doc.name`).
  - Mime must never be a *security* decision input — the sandbox rules per renderer hold regardless of what the mime claims (e.g. text is always rendered as text, never iframed — the existing comment in `document-preview.tsx` already encodes this).
  - Optional hardening: magic-byte sniffing server-side at upload with `file-type` (sindresorhus, 22.0.1, MIT, active) and store a `detectedMime` column. Nice-to-have, not a blocker — every recommended renderer treats bytes as untrusted anyway.

### Vite chunk-splitting

Every renderer follows the proven `use-pdf-module.ts` pattern: a `useXModule()` hook whose `useEffect` does `import("epubjs")` / `import("docx-viewer-module")` etc. Vite turns each dynamic import into its own chunk automatically; nothing ships in the shell. jszip is shared by the epub and docx chunks and Vite will hoist it into a common chunk on its own. Shiki languages are themselves dynamic imports inside the shiki chunk (per its performance guide). No `manualChunks` config needed.

### Preview registry design

Today `document-drawer.tsx:77` special-cases `application/pdf` → `PdfViewerSrc`, and `DocumentPreview` hardcodes image/text/none. Replace both with an ordered provider list in `apps/web/src/components/knowledge/preview-registry.ts`:

```ts
export interface PreviewProvider {
  id: string;                                  // "pdf" | "epub" | "docx" | ...
  matches(doc: { mime: string; name: string }): boolean; // mime OR extension
  maxBytes: number;                            // over → DownloadFallback with size reason
  // Lazy component; receives the doc and uses documentContentUrl() or
  // client.knowledgeBase.download() itself, mirroring TextPreview/PdfViewerSrc.
  Component: React.LazyExoticComponent<React.ComponentType<{ doc: KnowledgeDocument }>>;
}

export const previewProviders: PreviewProvider[] = [
  pdfProvider,      // mime application/pdf | .pdf            — 100 MB (streams)
  imageProvider,    // image/* except tiff/heic               — no cap (streams)
  epubProvider,     // application/epub+zip | .epub           — 50 MB
  docxProvider,     // vnd.openxml…wordprocessingml | .docx   — 10 MB
  xlsxProvider,     // vnd.openxml…spreadsheetml | .xlsx      — 20 MB
  csvProvider,      // text/csv | .csv | .tsv                 — 25 MB (worker-streamed)
  codeProvider,     // known code extensions                  — 5 MB (highlight ≤500 KB)
  textProvider,     // text/* | application/json              — 5 MB (existing)
];
// DocumentPreview = first match → size gate → <Suspense fallback={PreviewSkeleton}><Component/></Suspense>
// no match → existing DownloadFallback. MOBI, .doc, .xls, TIFF, HEIC intentionally have no provider.
```

`DocumentPreview` keeps its exact external contract (drawer body taking `doc`), so the drawer's PDF special case folds into the registry with zero route changes. Each provider's `ErrorBoundary`/`onError` degrades to `DownloadFallback`, matching current behavior.

### Sandbox rules (normative)

| Renderer | Rule |
|---|---|
| text/code/CSV/XLSX cells | render as React text nodes only; never iframe, never `innerHTML` |
| PDF | pdf.js canvas/text-layer; self-hosted worker |
| EPUB | epub.js inner iframe stays `sandbox="allow-same-origin"` (no `allow-scripts`); `allowScriptedContent`/`allowPopups` are forbidden options |
| DOCX (and any future HTML-producing format) | `renderAltChunks: false`; preferred host = `<iframe sandbox="allow-scripts">` (opaque origin, bytes via postMessage); if rendered in-DOM instead, output must pass DOMPurify |
| Uploaded `text/html` | continues to render as plain text (existing rule in `document-preview.tsx` — blob/streamed URLs share the app origin) |

## 10. Not worth it — ship the download fallback

| Type | Reason |
|---|---|
| MOBI / AZW3 / PRC | no officially-published npm parser; foliate-js is MIT but git-submodule-only and its npm name is third-party-squatted; conversion (Calibre, GPLv3) is server bloat |
| Legacy `.doc` / `.xls` / `.ppt` | binary CFB formats; docx-preview/mammoth are OOXML-only; SheetJS can read `.xls` but the preview value doesn't justify widening the attack surface of a 1997 binary format — revisit only on user demand (SheetJS 0.20.3 would handle `.xls` for free if so) |
| HEIC/HEIF | not a web image format (absent from MDN's format guide; no Chromium/Firefox support); client wasm decoders are stale multi-MB deps; server-side `sharp` conversion is the right fix if ever needed |
| TIFF | Safari-only per MDN; decoder libs stale |
| RTF / ODT / iWork | no maintained browser renderers worth the surface area |
| Archives (.zip/.tar) | listing-only preview is a different feature; out of scope |

## Sources

- npm registry metadata via `npm view` (2026-07-22): `epubjs` 0.3.93/BSD-2/pub-2022-02-16 · `react-reader` 2.0.15/ISC · `mammoth` 1.12.0/BSD-2 · `docx-preview` 0.4.0/Apache-2.0 · `xlsx` 0.18.5-latest/pub-2022-03-24 · `exceljs` 4.4.0/MIT · `papaparse` 5.5.4/MIT · `shiki` 4.3.1/MIT · `foliate-js` 1.0.1 maintainer `shmandadi` · `@tanstack/react-virtual` 3.14.7/MIT · `react-pdf` 10.4.1 (react ^19 peer, pdfjs-dist 5.4.296) · `file-type` 22.0.1/MIT · `highlight.js` 11.11.1/BSD-3 · `prismjs` 1.30.0
- GitHub repo API (license/pushed_at/issues): futurepress/epub.js · johnfactotum/foliate-js · mwilliamson/mammoth.js · VolodymyrBaydalka/docxjs · exceljs/exceljs · mholt/PapaParse · gerhardsletten/react-reader
- Source/README reads: [epub.js `iframe.js`](https://github.com/futurepress/epub.js/blob/master/src/managers/views/iframe.js) (sandbox logic quoted in §2) · [foliate-js README](https://github.com/johnfactotum/foliate-js) · [mammoth README](https://github.com/mwilliamson/mammoth.js) (no-sanitisation warning) · [docx-preview README](https://github.com/VolodymyrBaydalka/docxjs) (`renderAltChunks` default) · [react-reader README](https://github.com/gerhardsletten/react-reader)
- Official docs: [shiki.style best-performance guide](https://shiki.style/guide/best-performance) · [papaparse.com/docs](https://www.papaparse.com/docs) · [MDN image types](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)
- SheetJS: `https://cdn.sheetjs.com/xlsx-latest/package/package.json` (→ 0.20.3, Apache-2.0) · [GitHub advisories for npm xlsx](https://github.com/advisories?query=xlsx) (CVE-2023-30533, CVE-2024-22363; no patched npm version)
- Measured bundle sizes: direct downloads of each library's minified dist from unpkg/cdn.sheetjs.com (bytes listed inline)
- Repo grounding: `apps/web/src/components/knowledge/{document-preview,document-drawer,content-url,use-document-upload}.tsx?` · `apps/web/src/components/pdf/{pdf-viewer,use-pdf-module}.tsx?` · `apps/server/src/knowledge-content.ts` · `pnpm-lock.yaml` (zero `shiki`/`react-virtual` entries) · `packages/ui/src/components/response.tsx` + installed `streamdown@2.5.0` dist inspection
