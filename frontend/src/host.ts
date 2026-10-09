// Everything the app does: talking to the previews, selection, hover, the layers tree, search.
// Components only read the store and call the functions exported here.
import { apiUrl, getJson, isScreens } from "./api";
import { Cancelled, Timeout, maybeThrow, messageOf, raise, reportOnly, safe, type Ctx } from "./failures";
import { MAX_Z, MIN_Z, get, newTree, update, useStore, type Box, type Row } from "./store";

// ---------- board layout ----------
export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const LABEL_H = 32; // the screen name above each preview
const GAP = 40;
const COLS = 4;
export const cellOf = (i: number) => ({ x: (i % COLS) * (PREVIEW_W + GAP), y: Math.floor(i / COLS) * (PREVIEW_H + LABEL_H + GAP) });

const boardCtx: Ctx = { region: "board", screenId: null };
const previewCtx = (sid: string): Ctx => ({ region: "preview", screenId: sid });

// ---------- one connection per preview ----------
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: number };
type Conn = { sid: string; el: HTMLIFrameElement; origin: string; pageId: string | null; pending: Map<number, Pending>; timer?: number; lastTrack: string };
const conns = new Map<string, Conn>();
let nextRid = 0;

function post(c: Conn, type: string, data: object = {}) {
  if (c.pageId) c.el.contentWindow?.postMessage({ src: "host", pageId: c.pageId, type, ...data }, c.origin);
}

/** Ask a page something. Rejects with Cancelled if the page goes away, Timeout if it is too slow. */
export function ask<T>(sid: string, type: string, payload: object = {}, ms = 3000): Promise<T> {
  const c = conns.get(sid);
  if (!c?.pageId) return Promise.reject(new Cancelled());
  return new Promise<T>((resolve, reject) => {
    const rid = ++nextRid;
    const timer = window.setTimeout(() => { c.pending.delete(rid); reject(new Timeout("The page didn't answer")); }, ms);
    c.pending.set(rid, { resolve, reject, timer });
    if (type === "children" && get().dev.dropChildren === sid) {
      update((s) => { s.dev.dropChildren = null; }); // dev: pretend the page never answers
      return;
    }
    post(c, type, { rid, ...payload });
  });
}

function dropPending(c: Conn) {
  for (const p of c.pending.values()) { clearTimeout(p.timer); p.reject(new Cancelled()); }
  c.pending.clear();
}

function startConnectTimer(c: Conn) {
  clearTimeout(c.timer);
  c.timer = window.setTimeout(safe(previewCtx(c.sid), () => {
    if (conns.get(c.sid) === c && !c.pageId) raise(previewCtx(c.sid), new Error("Couldn't connect to this preview"));
  }), get().dev.connectMs);
}

/** The iframe's ref callback. */
export function mountIframe(sid: string, el: HTMLIFrameElement | null) {
  const old = conns.get(sid);
  if (old && old.el !== el) { dropPending(old); clearTimeout(old.timer); conns.delete(sid); }
  if (!el || old?.el === el) return;
  const screen = get().screens!.find((s) => s.id === sid)!;
  const c: Conn = { sid, el, origin: new URL(screen.url).origin, pageId: null, pending: new Map(), lastTrack: "" };
  conns.set(sid, c);
  startConnectTimer(c);
}

// ---------- messages from the pages ----------
function onMessage(e: MessageEvent) {
  const d = e.data;
  if (!d || d.src !== "agent") return;
  const c = [...conns.values()].find((c) => c.el.contentWindow === e.source);
  if (!c || e.origin !== c.origin) return; // only our own iframes, on the origin they were given
  safe(previewCtx(c.sid), () => handle(c, d))();
}

function handle(c: Conn, d: any) {
  const sid = c.sid;
  maybeThrow("message", sid);
  if (d.type === "hello") {
    if (get().errors[`preview:${sid}`] || c.pageId === d.pageId) return; // stay failed until Retry
    resetPage(sid);
    c.pageId = d.pageId;
    clearTimeout(c.timer);
    update((s) => { s.previews[sid].ready = true; });
    return;
  }
  if (d.pageId !== c.pageId) return; // from a document we are not talking to any more
  switch (d.type) {
    case "reply": {
      const p = c.pending.get(d.rid);
      if (!p) return; // too late: it timed out or was cancelled
      c.pending.delete(d.rid);
      clearTimeout(p.timer);
      d.error ? p.reject(new Error(d.error)) : p.resolve(d.data);
      maybeThrow("response", sid);
      break;
    }
    case "tracked": {
      const boxes: Record<string, Box | null> = d.boxes;
      update((s) => {
        // A message that was already on its way when the selection changed doesn't mention the new ids.
        // Keep what we knew about the ids we are drawing, so nothing flickers or remounts.
        const selected = s.sel?.sid === sid ? s.sel.ids : [];
        const drawn = s.hover?.sid === sid ? [...selected, s.hover.id] : selected;
        const nextBoxes = { ...boxes };
        const nextLives = { ...d.lives };
        for (const id of drawn) {
          if (!(id in nextBoxes) && s.boxes[sid]?.[id]) nextBoxes[id] = s.boxes[sid][id];
          if (selected.includes(id) && !(id in nextLives) && !(id in nextBoxes && nextBoxes[id] === null) && s.lives[sid]?.[id]) nextLives[id] = s.lives[sid][id];
        }
        s.boxes[sid] = nextBoxes;
        s.lives[sid] = nextLives;
        if (s.hover?.sid === sid && boxes[s.hover.id] === null) s.hover = null;
        if (s.sel?.sid === sid) {
          const ids = s.sel.ids.filter((id) => boxes[id] !== null); // drop elements that no longer exist
          if (ids.length !== s.sel.ids.length) {
            s.sel = ids.length ? { sid, ids } : null;
            s.gone = ids.length === 0;
          }
        }
      });
      break;
    }
    case "changed": refreshTree(sid); break;
    case "pageError":
      reportOnly(previewCtx(sid), new Error(d.message));
      update((s) => { const p = s.previews[sid]; p.pageError = { message: d.message, count: (p.pageError?.count ?? 0) + 1 }; });
      break;
    case "bye":
      resetPage(sid);
      c.pageId = null;
      update((s) => { s.previews[sid].ready = false; });
      startConnectTimer(c);
      break;
    case "key": shortcut(d.key); break;
    case "zoom": {
      const { view } = get();
      const i = get().screens!.findIndex((s) => s.id === sid);
      const o = cellOf(i);
      zoomAt(view.x + o.x * view.z + d.x * view.z, view.y + (o.y + LABEL_H) * view.z + d.y * view.z, d.dy);
      break;
    }
  }
}

/** A page was replaced (navigation) or reloaded: forget everything we knew about the old one. */
function resetPage(sid: string) {
  const c = conns.get(sid);
  if (c) { dropPending(c); c.lastTrack = ""; }
  delete scrollMemory[sid];
  delete scrollMemory[sid + "#s"];
  update((s) => {
    s.trees[sid] = newTree();
    delete s.boxes[sid];
    delete s.lives[sid];
    if (s.sel?.sid === sid) { s.sel = null; s.gone = false; }
    if (s.hover?.sid === sid) s.hover = null;
    if (s.previews[sid]) s.previews[sid].pageError = undefined;
  });
}

// The pages draw nothing; they only need to know which ids the host is drawing, so they can measure them.
function syncTrack() {
  const s = get();
  for (const c of conns.values()) {
    if (!c.pageId) continue;
    const hover = s.mode === "select" && s.hover?.sid === c.sid ? s.hover.id : null;
    const selected = s.sel?.sid === c.sid ? s.sel.ids : [];
    const json = JSON.stringify([hover, selected]);
    if (json !== c.lastTrack) { c.lastTrack = json; post(c, "track", { hover, selected }); }
  }
}

// ---------- the board ----------
export async function loadScreens(fail?: number) {
  update((s) => { Object.assign(s, { screens: null, errors: {}, active: null, sel: null, gone: false, hover: null, previews: {}, trees: {}, boxes: {}, lives: {}, reveal: null }); });
  try {
    const { body } = await getJson(apiUrl("/screens", fail));
    if (!isScreens(body)) throw new Error("The server sent bad data");
    update((s) => {
      s.screens = body as any;
      for (const sc of s.screens!) { s.previews[sc.id] = { attempt: 0, ready: false }; s.trees[sc.id] = newTree(); }
    });
  } catch (e) {
    raise(boardCtx, e, `Couldn't load screens. ${messageOf(e)}`);
  }
}

export function retryPreview(sid: string) {
  update((s) => { delete s.errors[`preview:${sid}`]; s.previews[sid] = { attempt: s.previews[sid].attempt + 1, ready: false }; s.dev.draw = null; });
  resetPage(sid);
}

export function panBy(dx: number, dy: number) {
  clearHover();
  update((s) => { s.view.x += dx; s.view.y += dy; });
}

export function zoomAt(px: number, py: number, deltaY: number) {
  clearHover();
  update((s) => {
    const { x, y, z } = s.view;
    const nz = Math.min(MAX_Z, Math.max(MIN_Z, z * Math.exp(-deltaY * 0.002)));
    s.view = { x: px - ((px - x) * nz) / z, y: py - ((py - y) * nz) / z, z: nz }; // the point under the pointer stays put
  });
}

export function setMode(mode: "select" | "interact") {
  clearHover();
  update((s) => { s.mode = mode; });
}

/** Select mode: the page can't scroll under the click-catcher, so we pass the wheel on. */
export function wheelPage(sid: string, x: number, y: number, dx: number, dy: number) {
  const c = conns.get(sid);
  if (c) post(c, "wheel", { x, y, dx, dy });
  window.setTimeout(safe(previewCtx(sid), () => { if (get().hover?.sid === sid) probeHover(sid, x, y); }), 80);
}

// ---------- hover ----------
type Hit = { id: string; chain: string[]; box: Box };
let probing = false;
let nextProbe: [string, number, number] | null = null;
let hoverEpoch = 0; // bumped whenever hover is cleared, so a late answer can be ignored

export function probeHover(sid: string, x: number, y: number) {
  if (get().mode !== "select") return;
  if (probing) { nextProbe = [sid, x, y]; return; } // one question at a time; only the latest position matters
  probing = true;
  const epoch = hoverEpoch;
  ask<Hit | null>(sid, "hit", { x, y }, 1500)
    .then((hit) => {
      if (epoch !== hoverEpoch) return;
      update((s) => {
        s.hover = hit ? { sid, id: hit.id, chain: hit.chain } : null;
        if (hit) (s.boxes[sid] ??= {})[hit.id] = hit.box;
      });
    })
    .catch((e) => { if (!(e instanceof Cancelled || e instanceof Timeout)) raise(previewCtx(sid), e); })
    .finally(() => {
      probing = false;
      const n = nextProbe;
      nextProbe = null;
      if (n) probeHover(...n);
    });
}

export function clearHover() {
  hoverEpoch++;
  nextProbe = null;
  if (get().hover) update((s) => { s.hover = null; });
}

export function hoverFromRow(sid: string, id: string) {
  hoverEpoch++;
  update((s) => { s.hover = { sid, id, chain: [id] }; });
}

// ---------- selection ----------
export async function clickAt(sid: string, x: number, y: number, shift: boolean) {
  maybeThrow("click", sid);
  let hit: Hit | null;
  try { hit = await ask<Hit | null>(sid, "hit", { x, y }, 1500); } catch (e) { if (e instanceof Cancelled || e instanceof Timeout) return; throw e; }
  update((s) => { s.active = sid; delete s.errors.layers; });
  if (!hit) return clearSelection(); // clicked the page background
  const cur = get().sel;
  let ids = [hit.id];
  if (shift && cur?.sid === sid) ids = cur.ids.includes(hit.id) ? cur.ids.filter((i) => i !== hit.id) : [...cur.ids, hit.id];
  select(sid, ids);
}

function select(sid: string, ids: string[]) {
  update((s) => { s.sel = ids.length ? { sid, ids } : null; s.gone = false; delete s.errors.inspector; });
  const last = ids[ids.length - 1];
  if (last) reveal(sid, last);
}

export function clearSelection() {
  update((s) => { s.sel = null; s.gone = false; });
}

export function selectFromRow(sid: string, id: string, shift: boolean) {
  const cur = get().sel;
  let ids = [id];
  if (shift && cur?.sid === sid) ids = cur.ids.includes(id) ? cur.ids.filter((i) => i !== id) : [...cur.ids, id];
  select(sid, ids);
  if (ids.includes(id)) scrollPage(sid, id);
}

export function scrollPage(sid: string, id: string) {
  const c = conns.get(sid);
  if (c) post(c, "scrollTo", { id });
}

/** Enter / Shift+Enter / Tab / Shift+Tab: the page works out the target, we select it. */
async function navigate(op: "child" | "parent" | "next" | "prev") {
  const sel = get().sel;
  if (!sel) return;
  const last = sel.ids[sel.ids.length - 1];
  try {
    const id = await ask<string | null>(sel.sid, "nav", { id: last, op });
    const now = get().sel;
    if (id && now?.sid === sel.sid && now.ids[now.ids.length - 1] === last) { select(sel.sid, [id]); scrollPage(sel.sid, id); }
  } catch (e) {
    if (!(e instanceof Cancelled || e instanceof Timeout)) raise(previewCtx(sel.sid), e);
  }
}

// ---------- keyboard ----------
function shortcut(key: string) {
  if (key === "v" || key === "V") setMode("select");
  else if (key === "i" || key === "I") setMode("interact");
  else if (key === "Escape") clearSelection();
}

function onKeyDown(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  if (get().dev.key) { update((s) => { s.dev.key = false; }); throw new Error("Dev: simulated error in a key handler"); }
  if (["v", "V", "i", "I", "Escape"].includes(e.key)) return shortcut(e.key);
  // Enter and Tab move the selection, unless a button or link has focus and should keep its own behaviour.
  if ((e.key === "Enter" || e.key === "Tab") && get().mode === "select" && get().sel && !/^(BUTTON|A)$/.test(t.tagName)) {
    e.preventDefault();
    navigate(e.key === "Tab" ? (e.shiftKey ? "prev" : "next") : e.shiftKey ? "parent" : "child");
  }
}

// ---------- the layers tree ----------
export const scrollMemory: Record<string, number> = {}; // panel scroll per preview; not state, nothing renders from it

/** Children of one element ("" = <body>). One load per row at a time; the answer replaces the old list. */
export async function loadKids(sid: string, pid: string) {
  if (get().trees[sid]?.load[pid] === "loading") return;
  update((s) => { s.trees[sid].load[pid] = "loading"; });
  try {
    const rows = await ask<Row[] | null>(sid, "children", { parent: pid || null }, 3000);
    update((s) => {
      const t = s.trees[sid];
      delete t.load[pid];
      if (rows) t.kids[pid] = rows;
      else delete t.kids[pid]; // the element is gone
    });
  } catch (e) {
    if (e instanceof Cancelled) return; // the page went away: nothing failed
    update((s) => { s.trees[sid].load[pid] = "error"; });
    raise({ region: pid ? "layers-row" : "layers", screenId: sid }, e, "Couldn't load");
  }
}

export function toggleOpen(sid: string, id: string) {
  const t = get().trees[sid];
  const open = !t.open[id];
  update((s) => { s.trees[sid].open[id] = open; });
  if (open && !t.kids[id]) loadKids(sid, id);
}

/** Select from the page: open every ancestor of the row (one request for all levels) and scroll to it. */
async function reveal(sid: string, id: string) {
  if (get().trees[sid]?.query) return; // while searching, never touch what is expanded
  try {
    const levels = await ask<{ parent: string | null; kids: Row[] }[] | null>(sid, "path", { id }, 3000);
    const sel = get().sel;
    if (!levels || sel?.sid !== sid || sel.ids[sel.ids.length - 1] !== id) return;
    update((s) => {
      const t = s.trees[sid];
      for (const l of levels) { t.kids[l.parent ?? ""] = l.kids; if (l.parent) t.open[l.parent] = true; }
      s.reveal = { sid, id, n: (s.reveal?.n ?? 0) + 1 };
    });
  } catch (e) {
    if (!(e instanceof Cancelled)) raise({ region: "layers", screenId: sid }, e, "Couldn't load");
  }
}

export function retryLayers() {
  const { active, trees, sel } = get();
  update((s) => { delete s.errors.layers; s.dev.layers = false; if (active) s.trees[active].load = {}; });
  if (!active) return;
  if (trees[active].query) runSearch(active);
  else if (sel?.sid === active) reveal(active, sel.ids[sel.ids.length - 1]);
}

// When the page changes its own DOM it says so, and we re-read the levels we already have.
// Expanded rows live in `open`, which this never touches, so they keep their state.
const refreshing: Record<string, "running" | "again" | undefined> = {};
async function refreshTree(sid: string) {
  if (refreshing[sid]) { refreshing[sid] = "again"; return; }
  refreshing[sid] = "running";
  const pids = Object.keys(get().trees[sid]?.kids ?? {});
  await Promise.all(pids.map(async (pid) => {
    try {
      const rows = await ask<Row[] | null>(sid, "children", { parent: pid || null });
      update((s) => { const t = s.trees[sid]; if (rows) t.kids[pid] = rows; else delete t.kids[pid]; });
    } catch (e) {
      if (!(e instanceof Cancelled)) raise({ region: pid ? "layers-row" : "layers", screenId: sid }, e);
    }
  }));
  if (get().trees[sid]?.query) runSearch(sid);
  const again = (refreshing[sid] as string) === "again"; // set by a refresh request that came in meanwhile
  refreshing[sid] = undefined;
  if (again) refreshTree(sid);
}

// ---------- search ----------
export function setSearch(sid: string, query: string) {
  update((s) => { s.trees[sid].query = query; if (!query) s.trees[sid].found = null; });
  if (query) runSearch(sid);
}

async function runSearch(sid: string) {
  const q = get().trees[sid]?.query;
  if (!q) return;
  try {
    const found = await ask<any[]>(sid, "search", { q }, 5000);
    if (get().trees[sid]?.query !== q) return; // the user kept typing: this answer is out of date
    update((s) => { s.trees[sid].found = found; });
  } catch (e) {
    if (!(e instanceof Cancelled)) raise({ region: "layers", screenId: sid }, e, "Couldn't search");
  }
}

// ---------- dev menu ----------
export function devBreakPreview(sid: string) {
  update((s) => { delete s.errors[`preview:${sid}`]; s.previews[sid] = { attempt: s.previews[sid].attempt + 1, ready: false, broken: true }; });
  resetPage(sid);
}
export function devThrowInPage(sid: string) {
  const c = conns.get(sid);
  if (c) post(c, "devThrow");
}
export function devThrowInTimer(sid: string) {
  window.setTimeout(safe(previewCtx(sid), () => { throw new Error("Dev: simulated error in a timer"); }), 50);
}

// ---------- start ----------
export function initHost() {
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", safe(boardCtx, onKeyDown));
  window.addEventListener("blur", clearHover);
  useStore.subscribe(syncTrack);
  loadScreens();
}
