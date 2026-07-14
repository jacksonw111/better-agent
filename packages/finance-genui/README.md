# @jacksonw111/finance-genui

Interactive React renderers for the [Better Agent](https://github.com/jacksonw111/better-agent) finance MCP tool results — 14 archetypes (charts, tables, rank lists, panels) keyed by `finance_*` tool name. Connect an agent to the finance MCP and render its tool results out of the box.

## Install

```bash
npm install @jacksonw111/finance-genui
```

This package is published to GitHub Packages. Add to `.npmrc`:

```
@jacksonw111:registry=https://npm.pkg.github.com
```

### Peer dependencies

`react >=19`, `react-dom >=19`, and `zod >=3` are peers — install them in your app.

## Usage

```tsx
import { FINANCE_RENDERERS, unwrapToolResult } from "@jacksonw111/finance-genui";
import "@jacksonw111/finance-genui/styles.css";

// Spread FINANCE_RENDERERS into your own tool-name → renderer registry, then
// render a tool result by its finance_* name.
const registry = { ...FINANCE_RENDERERS };

function ToolResult({ name, result }) {
	const entry = registry[name];
	if (!entry) {
		return null;
	}
	const parsed = entry.parse(unwrapToolResult(result));
	return entry.render(parsed);
}
```

The chart renderers (recharts / lightweight-charts backed) are lazy-loaded via
`React.lazy` + dynamic `import()`, so charts ship in separate chunks and are not
pulled into your initial bundle. Wrap chart-bearing renderers in `<Suspense>`.

### PDF affordances

Supply a host-app link component via `PdfLinkProvider` to control how report
cards open PDFs (e.g. in a drawer). Without one, cards render a plain external
link.

```tsx
import { PdfLinkProvider } from "@jacksonw111/finance-genui";
```

## License

MIT
