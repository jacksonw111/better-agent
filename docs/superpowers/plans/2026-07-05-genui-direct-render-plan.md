# GenUI direct tool-result rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Tool results render as rich UI components directly when the tool call completes (registry-keyed by toolName), replacing the model-transcribed StructuredOutput pass. Unregistered tools keep the existing plain tool-block rendering. The whole StructuredOutput chain is then removed.

**Why:** the transcription pass is slow (model re-emits data as a JSON tree), lossy (hallucinated/dropped fields), and has been the root of multiple production bugs (structured:null vanish, deferral pollution, markdown-instead-of-components). Tool results are already structured — render them directly.

## Global Constraints
- No `any`; magic numbers ≠ -1/0/1 named; files ≤299 lines; functions ≤50 lines; eslint gates + tailwind checker; `pnpm dlx ultracite fix`; conventional commits; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; branch dev.
- Only SUCCESSFUL tool results (isError=false) get rich rendering; errors keep the existing error styling.
- Unregistered tools are untouched — existing tool-block UI is the universal fallback.
- MCP tool results commonly arrive as `content[0].text` JSON strings — the registry must parse defensively (zod safeParse; parse failure → fallback rendering, never crash).

---

### Task 1: Tool-result renderer registry + chat wiring (additive)

**Files:**
- Create `apps/web/src/genui/tool-renderers.tsx` (the registry) + tests.
- Modify the chat tool-block rendering path so an app can inject a `renderToolResult(toolName, result) → ReactNode | null` hook: trace it from `apps/web/src/components/chat/chat-view.tsx` → `packages/ui/src/components/chat/conversation.tsx` → `chat-row.tsx` → `tool.tsx`. Null → existing fallback UI.

**Design:**
- Registry shape: `Record<string, { parse(result: unknown): T | null; render(data: T): ReactNode }>` — `parse` handles: raw object, MCP `{content:[{type:"text",text:"<json>"}]}` envelope, and JSON-string results; zod safeParse inside; null on mismatch.
- Register the X tools that have obvious components: `x_search_tweets`/`x_user_tweets`/`x_user_replies`/`x_user_likes`/`x_tweet_thread` → tweet list rendered with the existing TweetCard genui renderer (read `apps/web/src/genui/` for what exists — reuse the components, adapt the prop mapping from the ACTUAL tool result shape in `apps/mcp/src/x/` (read the tool implementations to get the real field names)); `x_search_users`/`x_followers`/`x_following` → a compact user-card list (build a small UserCard if none exists, styling consistent with TweetCard).
- Rendering placement: inside the tool block, replacing the raw JSON result section when the registry hits (keep the collapsed tool-call header showing toolName/args so users still see what ran); successful only.
- Long lists: cap visible items at MAX_RENDERED_ITEMS = 20 with a "+N more" line (named const).

**Tests:** registry parse handles all three envelope shapes + malformed JSON → null; jsdom: a tool-result event for a registered tool renders the component, unregistered tool keeps fallback, isError keeps error UI.

### Task 2: Remove the StructuredOutput chain

**Files (trace carefully, this spans packages):**
- `packages/agent/src/session/runtime.ts` (structuredOutput flag, stopCondition, toolChoice, the genui-skips-deferral special case), `runtime-finalize.ts` (structured on done), `structured-output.ts` (+ its tests) — remove.
- `packages/agent/src/session/events.ts`: remove `structured` from the done event and the `structured-delta` event if nothing else emits it.
- `packages/client`: remove outputSchema from RunOptions and structured from RunResult/stream handling (`internal.ts`, `types.ts`, genui dir if present).
- `packages/ui/src/components/chat/chat-stream.ts` (applyStructured, GenuiStreamConfig.outputSchema), `chat-blocks.ts` (structured field on ChatMessage), `chat-row.tsx` (hasTree/renderTree branch — replace with the Task 1 renderToolResult path only), `conversation.tsx` (GenerativeUIChatConfig: drop outputSchema; keep renderers/handlers/tools ONLY if still used — investigate what `tools` (client data tools) do in the genui flow and keep them wired: the genui toggle now means "attach the genui data tools + rich rendering").
- `apps/web/src/genui/config.ts` etc.: drop outputSchema/schema exports; keep component renderers used by Task 1.
- `apps/server`: outputSchema pass-through in the prompt/stream API — remove input field (check packages/api and the agent-client stream options).
- Update ALL affected tests (runtime structured tests, client tests, genui-render tests, conversation tests) to the new contract; DELETE tests that only tested the removed feature.

**Design notes:**
- The composer's genui toggle stays: it now only controls whether the genui client tools are attached to the turn (and is irrelevant to rendering, which is always-on via the registry).
- GenerativeUI/NodeView tree renderer components: if TweetCard etc. are reused by Task 1 keep the component files; delete the tree-walking renderer (generative-ui.tsx, node-view, genui-tree lib) only if nothing references them after the refactor.
- grep for `structured`, `outputSchema`, `StructuredOutput`, `hasTree`, `renderTree` across the repo at the end — zero live references (docs/plans may mention them historically; leave docs).

**Tests:** full suites green: `pnpm -F @better-agent/agent test`, `pnpm -F @jacksonw111/agent-client test` (check actual pkg name), `pnpm -F @better-agent/ui test`, `pnpm -F web test`, `pnpm -F server test`, `pnpm check-types`.
