# Board viewer

A viewer for live, cross-origin page previews: a pannable, zoomable board of 24 iframes, hover and selection outlines drawn by the app, a lazy layers tree, an inspector, and failures that stay inside their own region. The brief is in [ASSIGNMENT.md](ASSIGNMENT.md).

```
npm install
npm start      # mock backend (:4000 API, :4001 pages) + the app on http://localhost:5173
```

Try `http://localhost:5173/?latency=1000&fail=0.3`: those two params are passed to every API call. The **Dev ▾** menu (top right, dev server only) triggers every failure from R6 on demand.

**Tests** run the real app in real Chromium: about 120 checks covering R1–R6, including exact `report()` counts.
```
pip install playwright && python3 -m playwright install chromium
npm start        # one terminal
npm test         # another (CHROME=/path/to/chrome to use an existing browser)
```

React + TypeScript + Vite, with zustand (and immer) for state. About 1,100 lines of app code, in `frontend/src`, plus the 260-line script `backend/pages/agent.js` that goes into each page.

| File | What it does |
|---|---|
| `backend/pages/agent.js` | the one script added to each page: answers the app's questions about the page |
| `frontend/src/host.ts` | all behaviour: talking to the pages, hover, selection, tree loading, search, keys |
| `frontend/src/store.ts` | the state |
| `frontend/src/failures.ts` | `raise()` (report once + show), `safe()` (wrap handlers and timers) |
| `Region.tsx` | error boundary + "error with Retry" box |
| `Board.tsx`, `Layers.tsx`, `Inspector.tsx`, `DevMenu.tsx` | the screen |

## The one idea

The pages are on another origin, so the app can never read their DOM. So each page runs `agent.js`, and the app **asks it questions over `postMessage`**: *what is at (x, y)? what are the children of e12? where is e12 now?* The app only ever holds small opaque ids (`"e12"`), never elements. It draws everything itself, in screen pixels, so a 1px outline stays 1px at any zoom.

In **Select mode** a transparent sheet sits over each iframe. Clicks land on the sheet, so the page never sees them: nothing is clicked, focused or submitted, and disabled controls can be selected like any other. The sheet asks the page what is under the pointer (`elementFromPoint`). In **Interact mode** the sheet is removed and the page runs normally.

## Decisions on ambiguous points

- **"Wheel over a preview scrolls that page, in both modes"** — in Interact mode the iframe scrolls natively. In Select mode the sheet receives the wheel, so the app forwards it and the page scrolls the right scroller (inner scroll areas first, then the page). No momentum scrolling in Select mode.
- **Ctrl/⌘ + wheel over an interactive preview** — the iframe would swallow it, so the agent forwards it as a `zoom` message.
- **Shortcuts after clicking inside a preview** — the agent forwards **V, I, Escape** when focus is inside the page (not while typing in a field). **Enter/Tab** only act in Select mode, where focus can't be inside a page, and only when no button, link or field has focus. So keyboard users aren't trapped, and Interact mode keeps the page's own Tab behaviour.
- **Active preview** is set by any click on a preview in Select mode, including a click on its background.
- **Clicking a page background clears the whole selection**, not just that preview's.
- **A page error** shows the badge, and is also reported once with `{region: "preview", screenId}`.
- **Region names in reports:** `board`, `preview`, `layers` (root list, search, panel render error), `layers-row` (one row's children), `details` (with `elementKey`), `inspector`. A failure while revealing a deep element reports as `layers`.
- **Layers list every element child** (including `<script>`), because "children of `<body>`" says so.
- **While a search is open, selecting a result doesn't expand rows**: that is what keeps "clearing the search restores exactly the expanded state" true.
- **A slow reply isn't a failure unless it is a row/search/path load** (3 s / 5 s). A hover or keyboard-navigation request that times out is dropped quietly.

## How state is organised

All of it is in one zustand store (`store.ts`). Components read it. Only functions in `host.ts` (and `raise()`) write to it.

| State | Who changes it |
|---|---|
| `view` (pan/zoom), `mode` | wheel and drag, toolbar, V / I |
| `active` (the preview the panels show) | a Select-mode click on a preview |
| `sel` — one preview + its element ids | user clicks and keys; the page saying "this one is gone"; navigation |
| `hover` — one slot for the whole board | pointer over a preview, or over a layers row; cleared on pan, zoom, leave, mode change |
| `previews[id]` — ready, page-error badge | connection lifecycle and the page's error messages |
| `trees[id]` — rows per parent, loading/error per row, which rows are open, search | that page's answers; the user's expand/collapse and typing. Replaced wholesale when the page navigates |
| `boxes`, `lives` — outline rectangles and inspector values | **only** the page's `tracked` messages |
| `errors` — board, per preview, layers, inspector | only `raise()` and Retry |

The page is the source of truth for anything about the page; the app never computes a rectangle or reads a style. The layers panel's scroll positions are a plain module variable (`scrollMemory`): they change on every frame and nothing renders from them. The Details result is local to the Details component, so it disappears with its region.

## How the app and the pages talk

Messages are `{src, pageId, type, ...}`. `pageId` is random and new for every document, so a message from a page that has since navigated is recognised and dropped. The app accepts a message only if `event.source` is one of its iframes **and** `event.origin` matches that screen's origin; it sends with `targetOrigin` set to that origin. The page accepts only `event.source === window.parent`. Iframes are sandboxed without `allow-top-navigation`.

**Page → app:** `hello` (page is up), `bye` (leaving), `reply` (to a request), `tracked` (rectangles + inspector values for the ids being drawn, only when they changed), `changed` (the DOM changed), `pageError`, `key` (V/I/Escape pressed inside the page), `zoom`.
**App → page:** `track {hover, selected}`, and requests `hit`, `children`, `path` (all ancestor levels in one round trip, for deep reveals), `nav` (child/parent/next/prev), `search` (runs over the whole DOM), plus `scrollTo`, `wheel`.

**Slow.** Every request has a timeout (children/path 3 s, search 5 s, hit 1.5 s). The pending entry is dropped on timeout, so a late reply is ignored. A row that times out shows "Couldn't load" and a Retry for that row only. Hover keeps one question in flight and only the latest position is asked next.

**Gone.** When a page says `bye`, or says `hello` with a new `pageId` (navigation), all its pending requests are rejected as *cancelled* — which is never a failure — and its tree, selection, hover and rectangles are cleared. If no `hello` arrives within 10 s (or ever), the preview shows "Couldn't connect to this preview". A `hello` that arrives after that is ignored until Retry.

**Replaced.** Retry remounts the iframe, so the old window is no longer a known `event.source`. A newer search, selection or details request wins, and results of the older one are discarded without error or report.

**Identity across re-renders** (R3.7). The agent builds an element's id from something that survives a rebuild: `k:<data-key>` for a unique `data-key`; `i:<id>` for a unique `id` attribute; `k:<key>/LI.row.2/SPAN..0` for any element below a keyed one (tag, class and child index at each step, all verified); otherwise `e12`, tied to the node itself. While the original node is still in the page it is used as is. Only if it is gone is the id rebuilt from the key and path, and a step that doesn't match gives "gone", never a guess. On page 4 the keyed rows and everything inside them keep their selection through the 2-second rebuild; unkeyed rows are dropped, and the inspector says "This element no longer exists".

## Failures

Everything goes through `raise(ctx, error)`: it calls `report()` once (an `Error` object is remembered, so the same error never reports twice), and for board / preview / layers / inspector it sets that region's error, which shows a message and Retry. Handlers, timers and message callbacks are wrapped with `safe(ctx, fn)`; render errors are caught by `Region`. Details and rows keep their error in their own component or tree state. Cancelled work never reaches `raise`. Anything that escapes everything is reported once as `board`, without changing the UI (and skipped if a region just reported the same message, because React's dev mode replays render errors to `window.onerror`).

## Where this breaks

- **Elements with nothing stable to name them are lost on rebuild**: no `data-key`, no unique `id`, no keyed ancestor (page 4's even rows). They leave the selection instead of being matched by position. Below a keyed ancestor, a path match is only as good as the page's structure: if the page inserts a sibling with the same tag and class *before* the element, *inside* that keyed subtree, in the same moment that it rebuilds the element, the path can match its neighbour. That is the one case where the selection could jump.
- **Duplicate `data-key`s** are treated as no key at all.
- **Hit testing is `elementFromPoint`.** It can't see `pointer-events: none` elements (still selectable from the layers panel), treats shadow DOM and iframes inside a page as one element, and returns only the topmost one at a point.
- **Outlines are clipped to the preview, not to inner scroll areas or sticky headers**: an element scrolled out of a scroll area but still inside the preview keeps its outline outside the area.
- **Outlines lag by about one frame** (the page measures, then posts a message). Previews scrolled off screen are throttled by the browser, so their outlines update when they come back into view.
- **Select-mode scrolling is emulated** (no momentum, no overscroll, ignores scroll-snap and custom wheel handlers).
- **No virtualisation in the layers panel.** Page 5's ~100 expanded rows are fine; tens of thousands would not be. All 24 iframes load at once.
- **The layers panel re-reads every loaded level after any DOM change** (debounced to 100 ms). A page that changes attributes constantly causes constant refreshes.
- **Search results are a snapshot**, re-run after the page changes; no cap on size.
- **The agent trusts its page.** A page that overwrites `postMessage` or blocks the main thread breaks its own preview, and only that one.
- **Positions in the inspector** are relative to the page (not the preview).
- **The Dev menu only exists in the dev server** (`npm start`), not in a production build.

With another week: virtualise the layers rows; occlusion- and scroll-area-aware clipping; push-based change detection (`ResizeObserver`/`IntersectionObserver`) instead of a measuring loop; render only previews near the viewport; a shared protocol type between the two sides (today `agent.js` is plain JS and the types live in `host.ts` by convention).
