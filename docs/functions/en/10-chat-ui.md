# Chat UI

The chat UI is the conversation surface used by both the web app and the local-agent terminal. It renders a streaming agent turn as an ordered list of typed blocks — text, reasoning, tool invocations, and file attachments — and ships a generative-UI layer that turns select tool results into rich React components (tweet cards, user cards) instead of raw JSON.

## Architecture

The chat stack is split between the shared UI package and the web app's app-specific glue:

```
apps/web                            packages/ui/components/chat
┌────────────────────┐              ┌──────────────────────────────┐
│ ChatView           │  agentClient │ Conversation                 │
│  header + picker   │ ───────────▶ │  useChat(sessionId, client)  │
│  renderToolResult  │   renderTool │  ChatScroller → ChatRow[]    │
└────────┬───────────┘   Result     │  ChatComposer                │
         │                          └──────────────────────────────┘
         ▼ renderToolResult (genui)
┌────────────────────────────────────┐
│ TOOL_RESULT_RENDERERS              │
│  x_search_tweets → TweetCardFrom…  │
│  x_followers    → UserCard[]       │
│  x_search_users → UserCard         │
│  (+ unwrapToolResult, x-schemas)   │
└────────────────────────────────────┘
```

`Conversation` (`packages/ui/src/components/chat/conversation.tsx:103`) is the reusable core: given a `sessionId`, an `AgentClient`, and optional `avatars`/`composerTools`/`renderToolResult`, it owns the scroller, the draft stream, and the composer. `ChatView` (`apps/web/src/components/chat/chat-view.tsx:67`) is the web's wrapper — it adds the agent header, session picker, new-session button, and injects the web's `renderToolResult` and `AgentToolsMenu`.

### Block model

A turn is normalized into an ordered list of `ChatBlock`s (`packages/ui/src/components/chat/chat-blocks.ts:22`):

| Kind | Source | Rendered by |
|------|--------|-------------|
| `text` | `text-delta` events / persisted `text` parts | `<Response>` (markdown via Streamdown, streaming caret while `streaming`) |
| `reasoning` | `reasoning-delta` events / persisted `reasoning` parts | `<Reasoning>` collapsible |
| `tool` | `tool-call` + later `tool-result` (matched by `callId`) | `<ToolGroup>` — rich view when registered, else collapsible raw JSON |
| `file` | user attachments | `<AttachmentImage>` (images inline, other files as chips) |

`appendText` (`chat-blocks.ts:54`) coalesces consecutive same-kind deltas into one block so the stream produces one text block per step rather than one per token. Persisted messages are rebuilt by `buildBlocks` (`chat-blocks.ts:72`), which pairs `tool-call` and `tool-result` parts by `callId` into a single `ToolInvocation` with a `running`/`complete`/`error` status.

### Streaming pipeline

`useChat` (`packages/ui/src/components/chat/use-chat.ts:132`) is the hook behind `Conversation`:

1. **Session store** — `chatSession(sessionId)` returns a module-level per-session external store (`committed`, `draft`, `streaming`). Navigating away does not abort the turn or drop history; remounting resubscribes.
2. **Cold-start seed** — only when both `committed` and `draft` are empty, a `useQuery` calls `agentClient.listMessages(sessionId)` and maps rows via `toChatMessage`. Once the user interacts, the query freezes — there is no mid-session refetch, so the draft→history handoff simply doesn't exist on the client.
3. **Send** (`use-chat.ts:64`) — `initDraft` pushes a `complete` user row and a `streaming` assistant row (with `live: true`), then `streamPrompt` consumes the SDK's event stream, mutating the assistant draft in place.
4. **Commit** (`use-chat.ts:104`) — on turn completion the live draft is moved into `committed` in one atomic store update. No server fetch, no id swap, no blink.
5. **Observe** (`chat-observe.ts`) — if a cold-start reload finds the trailing assistant turn still `streaming` server-side (a detached turn), `observePollInterval` polls history every 1500ms until it settles or stalls for `STALL_MS` (120s).

### `streamPrompt` event mapping

`chat-stream.ts:79` `applyEvent` translates each `RunEvent` into block mutations, routed through a `StreamReveal` animator that throttles per-frame text/reasoning updates:

| Event | Action |
|-------|--------|
| `text-delta` | `pushDelta("text", …)` — append to the trailing text block, animate |
| `reasoning-delta` | `pushDelta("reasoning", …)` — append to trailing reasoning block |
| `tool-call` | seal the current reveal, push a new `tool` block (status `running`) |
| `tool-result` | patch the matching tool block by `callId` → set `result`, `isError`, status |
| `error` | set assistant `status: "error"` + `errorText` |

`sealReveal` is called when the kind flips (text↔reasoning) or at stream end, flushing the animator's pending tail so nothing is lost.

## Key Files

| File | Responsibility |
|------|----------------|
| `apps/web/src/components/chat/chat-view.tsx` | Web wrapper: header (agent name, model, session picker, new/close), injects `renderToolResult` + `AgentToolsMenu` |
| `apps/web/src/components/chat/use-restore-chat.ts` | On `/chat` entry, re-attach to `?agentId` or the tab's last session instead of starting fresh |
| `apps/web/src/components/chat/chat-session.ts` | `loadLastChat`/`saveLastChat` — per-tab `sessionStorage` of the active agent+session |
| `apps/web/src/genui/tool-renderers.tsx` | `TOOL_RESULT_RENDERERS` registry, `renderToolResult` hook, `entry`/`listEntry` builders |
| `apps/web/src/genui/tool-result-envelope.ts` | `unwrapToolResult` — normalize MCP envelope / JSON string / object to a plain value |
| `apps/web/src/genui/x-result-schemas.ts` | Resilient Zod schemas for normalized X tweet/profile data |
| `apps/web/src/genui/tweet-card-node.tsx` | `TweetCardFromTweet` — tweet/retweet/quote rendering |
| `apps/web/src/genui/user-card.tsx` | `UserCard` — compact X profile card |
| `apps/web/src/genui/embedded-tweet-node.tsx` | Shared embedded-tweet primitives (identity, media, stats, expandable text) |
| `packages/ui/src/components/chat/conversation.tsx` | `Conversation` — scroller + composer wiring, `useInitialSend` deferred first send |
| `packages/ui/src/components/chat/chat-row.tsx` | `ChatRow` dispatch on role; `AssistantBody` (Thinking shimmer, blocks, stopped/error/copy); `UserRow` (attachments + bubble) |
| `packages/ui/src/components/chat/chat-blocks.ts` | `ChatBlock`/`ChatMessage` types, `toChatMessage`, `appendText`, `messageText` |
| `packages/ui/src/components/chat/chat-stream.ts` | `streamPrompt` — RunEvent → block mutation, `StreamReveal` animation, abort-aware |
| `packages/ui/src/components/chat/use-chat.ts` | `useChat` — session store, seed-vs-live ownership, send/stop, observe mode |
| `packages/ui/src/components/chat/chat-observe.ts` | Detached-turn polling: `liveTrailingTurn`, `turnFingerprint`, stall detection |
| `packages/ui/src/components/chat/chat-composer.tsx` | `PromptInput`-based composer, attach button, submit/stop, `toolsSlot` |
| `packages/ui/src/components/chat/chat-attachments.tsx` | `usePendingAttachments` (upload-on-select), `ChipRow`, `readyAttachments` |
| `packages/ui/src/components/chat/attachment-image.tsx` | `AttachmentImage` — object-URL render of token-scoped attachments |
| `packages/ui/src/components/chat/tool.tsx` | `ToolGroup`/`ToolInvocationView` — rich-vs-plain rendering, `RenderToolResult` type |
| `packages/ui/src/components/chat/chat-session-store.ts` | Module-level per-session external store |
| `apps/web/src/utils/chat-client.ts` | `userAgentClient(agentId)` — builds a user-plane `AgentClient` from the oRPC client |

## Data Flow

### Sending a message

1. `ChatComposer.submit` (`chat-composer.tsx:102`) trims text, waits for all pending attachments (`readyAttachments`), and calls `onSend(text, ready)`.
2. `useChat.send` → `sendMessage` (`use-chat.ts:64`): abort if already streaming, set up an `AbortController`, `initDraft` the user+assistant rows, then `streamPrompt`.
3. `streamPrompt` (`chat-stream.ts:117`) iterates `agentClient.stream(text, { sessionId, signal, attachmentIds })`. Each event mutates the assistant draft through `applyEvent`; the `StreamReveal.onFrame` callback calls `setDraft([...user, {...assistant}])` so React re-renders.
4. On abort, the loop breaks at `signal.aborted` (`chat-stream.ts:133`) so a slow stream can't keep re-rendering "Thinking…".
5. On completion the `finally` in `sendMessage` flips streaming off and `store.commit()` moves the draft into `committed`.

### Attachment lifecycle

`usePendingAttachments` (`chat-attachments.tsx:16`) uploads each selected file **immediately** via `agentClient.uploadAttachment(sessionId, file)` (after `downscaleImage`), tracking per-item `uploading`/`done`/`error`. The composer's submit is disabled while any item is `uploading`. Only `done` items (with a real `attachmentId`) pass through `readyAttachments` into the send. On send, `clear()` revokes every object URL.

Rendering a persisted attachment uses `AttachmentImage` (`attachment-image.tsx:42`), which calls the token-scoped `agentClient.getAttachment(id)` → `Blob` → object URL, revoked on unmount. Non-image files render as a labeled chip.

### Generative UI (tool results)

`ChatView` passes `renderToolResult` from `apps/web/src/genui/tool-renderers.tsx:189` into `Conversation` → `ChatRow` → `ToolGroup`. The render path for a completed, successful tool is:

1. `richResult` (`tool.tsx:56`) calls `renderToolResult(toolName, tool.result)`.
2. `renderToolResult` looks up `TOOL_RESULT_RENDERERS[toolName]`; unregistered names return `null` (fall back to the plain collapsible JSON block).
3. The registered entry's `parse(result)` first **unwraps** the result via `unwrapToolResult` (`tool-result-envelope.ts:34`) — handling all three on-the-wire shapes:
   - an already-parsed object/array (client tools),
   - the MCP `{content:[{type:"text",text:"<json>"}]}` envelope (apps/mcp's `toolText` helper),
   - a bare JSON string.
   Malformed JSON anywhere resolves to `undefined` so the schema `safeParse` fails cleanly.
4. The unwrapped value is validated against the entry's Zod schema. `entry` validates the whole value; `listEntry` validates **per element** and keeps the good ones — scraped X data is messy, and a single malformed tweet must not blank the whole render.
5. On success `render(data)` returns the React node — e.g. `TweetCardFromTweet` for tweet lists, `UserCard` for profile lists.

A rich result renders always-visible (`RichToolView`, `tool.tsx:70`) with the raw call folded into a subtle details disclosure beneath it, so the component the feature exists to show is never hidden behind a collapsed toggle.

## Design Rationale

- **Shared UI package, app-specific glue** — `Conversation`, `useChat`, the block model, and the streaming pipeline live in `packages/ui` so the local-agent terminal reuses them unchanged; only `ChatView` + the genui registry are web-specific.
- **Live draft is the single source of truth while on the page** — the seed query freezes once the user interacts, so there is no draft→history id swap mid-session. The handoff only exists on cold start (refresh), where the server is authoritative. This eliminates the avatar-flash/markdown-reparse blink a swap would cause.
- **Positional keys on the scroller** — chat is append-only and the draft rows are never reordered; positional keys keep the draft→commit swap an in-place update rather than an unmount/remount.
- **`live` flag vs `status`** — only the in-flight draft shimmers "Thinking…"; a refetched (or stopped/orphaned) message stuck in `streaming` status must not shimmer forever, so `isThinking` requires `live === true`.
- **Per-element tolerant parse** — `listEntry` validates each element and keeps the valid ones, falling back to raw JSON only when the *shape* is wrong (non-array or every element fails), not when one stray item is odd.
- **`unwrapToolResult` before schema** — MCP tools, client tools, and string-only transports each arrive in a different envelope; normalizing once means every renderer schema validates a plain JS value.
- **Observe mode for detached turns** — turns run detached on the server; after a reload there is no local stream, but the trailing assistant turn may still be streaming. Polling history (with stall detection) keeps it updating without inventing a fake stream.
- **Deferred `useInitialSend`** — the first message is sent via a `setTimeout(0)` with cleanup, so a transient mount/unmount during the composer→chat slide cancels the stale schedule instead of aborting an already-started stream.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Observe poll interval | `packages/ui/src/components/chat/chat-observe.ts:9` | 1500 ms | `OBSERVE_POLL_MS` |
| Observe stall threshold | `packages/ui/src/components/chat/chat-observe.ts:10` | 120_000 ms | `STALL_MS` — stop polling a frozen turn |
| Max rendered genui items | `apps/web/src/genui/tool-renderers.tsx:15` | 20 | `MAX_RENDERED_ITEMS` (+N more line) |
| Tool result truncate | `packages/ui/src/components/chat/tool.tsx:13` | 2000 chars | `MAX_VALUE_CHARS` for raw JSON display |
| Accepted image types | `packages/ui/src/components/chat/chat-composer.tsx:19` | png/jpeg/webp/gif | `ACCEPT_IMAGES` on the file input |
| Tweet list tools | `apps/web/src/genui/tool-renderers.tsx:148` | 5 X tools | `TWEET_LIST_TOOLS` registry keys |
| Profile list tools | `apps/web/src/genui/tool-renderers.tsx:156` | 2 X tools | `PROFILE_LIST_TOOLS` registry keys |
| Last-chat storage key | `apps/web/src/components/chat/chat-session.ts:1` | `last_chat` | per-tab `sessionStorage` |
