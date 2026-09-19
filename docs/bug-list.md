# pi-web

Reviewed 2026-09-18 — each issue below has a proposed plan. Nothing implemented yet.

---

## 1. "ctx error" notice on every reply

**Symptom:** an error notice appears in the notice shelf every time the model finishes responding. Cause unknown.

**What I checked:**
- The literal string `ctx error` does not exist anywhere in pi-web, in the pi SDK, or in the last 7 days of session files (`errorMessage` fields contain only provider errors: `Connection error.`, `Operation aborted`, `402`, `429`, `401`, timeouts — nothing mentioning `ctx`).
- Error notices all funnel through `addNotice()` in `hooks/useAgentSession.ts:757`. Two paths can produce a bare, unattributed error:
  - `case "extension_error"` (`hooks/useAgentSession.ts:967`) — shows `event.error` only. The event also carries `extensionPath` and `event` (the hook name), both thrown away. This is emitted from `lib/rpc-manager.ts:220` (the pi `onError` callback), i.e. **an extension threw while handling an event** — which matches "every time the model responds".
  - `case "prompt_error"` (`:964`) — shows `errorMessage` only.
- Enabled extensions that run per-response: `research`, `code` (`before_agent_start`), `pi-live` (forwards `turn_end`/`agent_end`/`message_end`), plus packages `pi-safeguard`, `pi-session-move`, `pi-open-tui`, `pi-opencode-go-cache`, `pi-terminal-theme`.

**Plan:**
1. Make error notices self-identifying in `hooks/useAgentSession.ts`:
   - `extension_error` → message becomes `[<basename of extensionPath>] <event>: <error>` (e.g. `[pi-live] agent_end: Cannot read properties of undefined`).
   - Keep the full untruncated detail in `console.error` so the browser console has the stack/context.
2. Same treatment for `prompt_error`: prefix with the failing command type if available.
3. Reproduce once with the attribution in place, then fix the actual throwing extension (that part is a separate change in `~/.pi/agent/extensions/...`, not pi-web).
4. If the culprit turns out to be a benign/expected throw, downgrade it from `error` to `warning`/`info` or suppress it rather than leaving a red notice on every reply.

**Verify:** trigger a normal reply in pi-web; the notice (if any) now names the extension and hook.

**Open question for Eric:** if you still have the exact wording of the notice, paste it — it would skip step 1's guesswork.

---

## 2. Text selection invisible in the editor

**Symptom:** selection highlight is the same color as the current-line highlight. Both light and dark mode.

**Root cause (confirmed):** in `components/editor/extensions/theme.ts`
- `.cm-activeLine` → `var(--bg-hover)`
- `.cm-selectionBackground` → `var(--bg-selected)`

and in `app/globals.css` those two are nearly identical:

|       | `--bg-hover` (active line) | `--bg-selected` (selection) |
| ----- | -------------------------- | --------------------------- |
| light | `#eeeeee`                  | `#e8e8e8`                   |
| dark  | `#2e2e2e`                  | `#383838`                   |

Δ of ~6 and ~10 levels — effectively invisible, and worse on the active line where both overlap.

**Plan:**
1. Add a dedicated selection token in `app/globals.css` instead of reusing `--bg-selected` (which is used for selected rows/menus elsewhere and should stay neutral):
   - light: `--selection-bg: color-mix(in srgb, var(--accent) 26%, #ffffff);` (blue-tinted, same family as `--user-bg` but clearly stronger)
   - dark: `--selection-bg: color-mix(in srgb, var(--accent) 34%, #1a1a1a);`
2. Point the CodeMirror rule at it: `&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection { background: var(--selection-bg) !important; }` in `theme.ts:47`.
3. Add `.cm-selectionMatch` (find-in-file matches) a distinct but related tint so it doesn't collide with the real selection.
4. Add a global `::selection { background: var(--selection-bg); color: var(--text); }` in `globals.css` so plain textareas (the chat composer) and message text get the same treatment.
5. Check contrast of both `--text` over the new selection in light and dark; if the accent tint is too strong under the cursor, drop the mix percentage rather than changing text color.

**Verify:** open a file in the FileViewer editor in both themes, select text across the cursor's line — selection must be clearly distinguishable from the active-line band.

**Note:** your suggestion of reusing `--user-bg` works in light mode (`#eff6ff` vs `#eee`) but inverts in dark mode — `#1e293b` is *darker* than the `#2e2e2e` active line, so the selection would read as a shadow. Hence the accent-derived value.

---

## 3. OpenRouter DeepSeek v4 / v4.1 produce no reply

**Symptom:** message is sent and appears in the session; nothing comes back, no error either.

**Root cause (reproduced):** I created a throwaway session against `openrouter/deepseek/deepseek-v4-flash-0731` and read the resulting `.jsonl`. The assistant entry exists with:

```
stopReason: "error"
errorMessage: "402: This request requires more credits, or fewer max_tokens.
               You requested up to 942399 tokens, but can only afford 42650..."
```

with ~12 retries recorded in `metadata.previous_errors`. So two separate things:

1. **Account side (not a code bug):** your OpenRouter key's monthly credit limit is too low for the max_tokens pi requests for these models. Fix at https://openrouter.ai/settings/keys — raise or remove the key's limit. The raw API works fine when the request fits (`curl` against both model ids returns normally).
2. **pi-web side (the actual bug):** the error is recorded in the session file and never shown. `AssistantMessage` already carries `stopReason` / `errorMessage` (`lib/types.ts:61-62`) and they survive `session-reader.ts` unchanged, but `AssistantMessageView` (`components/MessageView.tsx:335`) only renders `content` blocks. A reasoning-only/errored message renders as an empty bubble — visually identical to "nothing happened". `prompt()` resolves rather than rejects when pi converts a provider error into a message, so `prompt_error` never fires either.

**Plan:**
1. In `AssistantMessageView`, when `message.stopReason === "error"` (or `errorMessage` is set), render a visible error block: red-tinted panel with a short label ("Model error") and the message text, collapsed to one line with expand-on-click for long provider payloads.
2. Also handle the "empty assistant message" case generally: if a completed assistant message has no renderable content blocks and no error, show a muted "(no content)" placeholder instead of a blank bubble.
3. Fire a one-shot `addNotice({ type: "error", ... })` when a run ends on an errored assistant message, so it's visible even if you're scrolled away — deduped per entry id so re-renders don't stack notices.
4. Truncate the notice text (~200 chars) but keep the full text in the message block.

**Verify:** with the key limit still low, select a DeepSeek model and send — a red error block and a notice should appear instead of silence. (After you raise the limit, this path just stops being reachable in normal use.)

---

## 4. Mid-run scrolling: content scrolls off the top of the page

**Symptom:** while a run is in progress you can scroll down until the last content is just above the viewport, leaving a screen of blank space. Correct behavior already happens once the run finishes.

**Root cause (confirmed):** `components/ChatWindow.tsx:700-702`

```jsx
{agentRunning && (
  <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
)}
```

A full **viewport-height** spacer is injected below the content for the duration of the run. It was added upstream in `c41cdd5` ("scroll lock during streaming with user message top-scroll behavior") so the just-sent user message can be pinned near the top of the viewport even when the reply is short. Side effect: max scroll is one viewport past the end of the content, and since the browser's scroll anchoring keeps you pinned at max scroll as content grows, you end up staring at the spacer with the actual reply pushed off the top.

**Plan:**
1. Replace the fixed spacer with a **dynamic** one that only fills the shortfall:
   `spacerHeight = clamp(viewportHeight - (contentBottom - lastUserMsgTop), 0, viewportHeight)`
   measured from the bottom of the last real content element (the streaming message wrapper / last message row), *not* from `scrollHeight` — measuring `scrollHeight` would include the spacer itself and feedback-loop.
   - Right after send: full-ish spacer, so the user message still lands at the top.
   - As the reply streams and fills the viewport: spacer shrinks to 0, so max scroll ends exactly where the content ends.
2. Implement it as a small `useStreamingSpacer` hook (ResizeObserver on the content wrapper + the last user message element + `window.resize`), returning a height that ChatWindow applies to the existing div. Keep the div mounted only while `agentRunning`.
3. Make mid-run stick-to-bottom **explicit** instead of relying on native scroll anchoring: a ResizeObserver on the content wrapper that calls `scrollToBottom("instant")` when the user is within ~40px of the bottom **and** `userScrollIntentUntilRef` has expired (the existing intent-tracking in `hooks/useAgentSession.ts:1644` already gives us this). This makes the behavior identical across Chrome/Safari/mobile instead of browser-dependent.
4. Mobile: the shrink-to-zero behavior should reduce the keyboard-avoidance problem rather than worsen it (less dead scroll range for iOS to pan through). Test with the composer focused and the keyboard open, mid-run.

**Verify:** send a long prompt; mid-run, scroll down — the last line of content should stop at the bottom of the viewport, no blank screen. Scroll back to the bottom mid-run and confirm it re-sticks as new text arrives. Scroll up mid-run and confirm it stays put.

---

## 5. URL support for queries (custom search engine)

**Goal:** add pi-web as a Brave custom search engine. Brave needs a URL template with `%s` for the term, e.g. `https://<host>:30141/?q=%s`, which should open a new session in the default workspace with the default model and run the query.

**Current state:** the only recognized param is `?session=<id>` (`components/AppShell.tsx:199`, `:202`). New sessions are created by ChatWindow's own send path with `newSessionCwd` supplied from the sidebar; the default workspace comes from `POST /api/default-cwd` (`app/api/default-cwd/route.ts` → `$JUMPERPEDIA_HOME/$PI_WEB_DEFAULT_WORKSPACE`, defaulting to `~/HalfaCloud/Jumperpedia/Quicknotes`).

**Plan:**
1. In `AppShell`, read `q` from `useSearchParams()` on mount (accept `query` as an alias). Handle it only when there is no `?session=` param, so a session restore never re-runs a query.
2. Resolve the target cwd: `POST /api/default-cwd` (already creates the dir and calls `allowFileRoot()`), falling back to the sidebar's current `activeCwd` if you'd rather the query land in the currently selected project. Default: always the default workspace, per your request.
3. Set `newSessionCwd` to that path and pass the query to `ChatWindow` as a `pendingQuery` prop.
4. In `ChatWindow`, when `pendingQuery` is set and the session is ready (models loaded, default model selected from `GET /api/models`'s `defaultModel`), call the existing `sendMessage(pendingQuery)` path once. Reuse the normal send path so the completion sound, voicemail notify arming, and `handleSessionCreated` all behave as if you typed it.
5. Immediately `router.replace("?session=<new id>")` after the send starts, so a refresh or back-navigation does not re-submit the query.
6. Guard against double-fire under React strict-mode/double-render with a `pendingQueryConsumedRef`.
7. Edge cases: empty/whitespace-only `q` → ignore and show the normal empty state; very long `q` → cap at a sane length (say 8k chars) and notice if truncated.

**Verify:** `open "http://localhost:30141/?q=test%20query"` in a fresh tab → new session in the default workspace with the default model, query already running, URL rewritten to `?session=...`. Then add the engine in Brave with keyword `pi` and confirm `pi <terms>` in the address bar works end to end over the Tailscale URL.

---

## Suggested order

| # | Issue                  | Confidence in root cause                               | Effort                                       |
| - | ---------------------- | ------------------------------------------------------ | -------------------------------------------- |
| 2 | Selection colors       | Confirmed                                              | Small — CSS only                             |
| 3 | Invisible model errors | Confirmed (code part)                                  | Small–medium                                 |
| 4 | Mid-run scroll spacer  | Confirmed                                              | Med. — measurement + mobile testing          |
| 5 | `?q=` search engine    | Understood, no unknowns                                | Med. — new wiring across AppShell/ChatWindow |
| 1 | "ctx error" notice     | **Not yet IDed** — needs 1 reproduction w/ attribution | Small change, then unknown                   |
