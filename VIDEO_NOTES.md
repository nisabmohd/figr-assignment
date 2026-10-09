# Video outline (15 min) — where to point in the code

**0:00–2:00 What and why.** The pages are cross-origin, so the app can't read them. Three calls: (1) each page runs one small script, `agent.js`, and the app *asks it questions*; the app only ever holds opaque ids; (2) Select mode puts a transparent sheet over each iframe, so the page can't see a click; (3) the page measures, the app draws in screen pixels, so 1px stays 1px at any zoom.

**2:00–10:00 Walkthrough** (show it running; Dev ▾ triggers each failure)
- R1 board: `Board.tsx` (world layer = iframes, screen layer = everything we draw), `host.ts` `zoomAt` / `panBy`; Interact-mode ctrl+wheel is forwarded by the agent.
- R2/R3 hover and select: `ClickCatcher` → `probeHover` (one request in flight, latest wins) → `agent.js` `hit`. Page 2: disabled button. Page 3: scroll area, sticky header.
- Identity: `agent.js` `stable` / `pathId` / `find`. Page 4: keyed rows survive the rebuild, an unkeyed one leaves the selection and the inspector says so.
- Navigation: page 6 link in Interact mode; `pageId`, `bye` / `hello`, `resetPage`.
- R4 tree: `loadKids` (one load per row, answer replaces the list), 3 s timeout via Dev, `path` for deep reveal (page 5), `visibleItems`, scroll anchoring in `Layers.tsx`, `runSearch`.
- R5 inspector: values come from the page's `tracked` messages; Details effect with abort + `current` flag; 404 vs failure.
- R6: `failures.ts` (`raise`, `safe`), `Region.tsx`, what each Dev item does, console shows exactly one `[report]` each.

**10:00–13:00 Where it breaks.** The README list. Show an unkeyed row leaving; outline outside an inner scroll area; no virtualisation.

**13:00–15:00 AI use.** Be honest. I first built a much bigger version (2,500 lines, jsdom tests only, never opened in a browser) and then rewrote it much smaller once I could run real Chromium. Real bugs the browser found that jsdom could not: a Retry button swallowed by pointer capture; React's dev mode double-reporting render errors; a stale `tracked` message remounting Details (two fetches); an id scheme that would have *jumped* the selection on page 4 (path under `ul#feed`).
