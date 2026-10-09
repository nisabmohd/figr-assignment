import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { clearHover, hoverFromRow, loadKids, retryLayers, scrollMemory, selectFromRow, setSearch, toggleOpen } from "./host";
import { Region } from "./Region";
import { safe } from "./failures";
import { useStore, type Row, type Tree } from "./store";

const ROW_H = 24;

type Item =
  | { kind: "row"; key: string; row: Row; depth: number; parent: string | null }
  | { kind: "loading"; key: string; depth: number; parent: string }
  | { kind: "error"; key: string; depth: number; parent: string };

/** The tree as a flat list of what is visible: expanded rows, plus a "loading" or "error" line under a row that needs one. */
function visibleItems(t: Tree): Item[] {
  if (t.query) return (t.found ?? []).map((row) => ({ kind: "row", key: row.id, row, depth: row.depth, parent: null }));
  const out: Item[] = [];
  const walk = (pid: string, depth: number) => {
    for (const row of t.kids[pid] ?? []) {
      out.push({ kind: "row", key: row.id, row, depth, parent: pid || null });
      if (!t.open[row.id]) continue;
      if (t.kids[row.id]) walk(row.id, depth + 1);
      else if (t.load[row.id] === "error") out.push({ kind: "error", key: "e:" + row.id, depth: depth + 1, parent: row.id });
      else if (t.load[row.id] === "loading") out.push({ kind: "loading", key: "l:" + row.id, depth: depth + 1, parent: row.id });
    }
  };
  walk("", 0);
  return out;
}

export function LayersPanel() {
  const active = useStore((s) => s.active);
  return (
    <aside className="panel">
      <div className="panel-head">Layers</div>
      <Region ctx={{ region: "layers", screenId: active }} onRetry={retryLayers}>
        {active ? <Tree sid={active} /> : <div className="empty">Click something in a preview</div>}
      </Region>
    </aside>
  );
}

function Tree({ sid }: { sid: string }) {
  const tree = useStore((s) => s.trees[sid]);
  const sel = useStore((s) => (s.sel?.sid === sid ? s.sel.ids : []));
  const hover = useStore((s) => (s.hover?.sid === sid ? s.hover : null));
  const reveal = useStore((s) => s.reveal);
  const crash = useStore((s) => s.dev.layers);
  if (crash) throw new Error("Dev: simulated layers panel render error");

  const items = useMemo(() => visibleItems(tree), [tree]);
  const searching = !!tree.query;
  const scroller = useRef<HTMLDivElement>(null);
  const memoryKey = sid + (searching ? "#s" : ""); // the search list and the tree remember their own scroll position
  const anchor = useRef<{ key: string; id: string; offset: number } | null>(null);

  // load <body>'s children the first time (and again after the page navigates)
  useEffect(() => {
    if (!tree.kids[""] && !tree.load[""]) loadKids(sid, "");
  }, [sid, tree.kids, tree.load]);

  // remember the scroll position, and which row is at the top of the view
  const rememberScroll = () => {
    const top = scroller.current!.scrollTop;
    scrollMemory[memoryKey] = top;
    const i = Math.floor(top / ROW_H);
    anchor.current = items[i] ? { key: memoryKey, id: items[i].key, offset: i * ROW_H - top } : null;
  };

  // the page changed its DOM: keep the row at the top where it was, so the list doesn't jump
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current!;
    if (!a || a.key !== memoryKey) return;
    const i = items.findIndex((it) => it.key === a.id);
    if (i >= 0 && Math.abs(i * ROW_H - a.offset - el.scrollTop) > 0.5) el.scrollTop = i * ROW_H - a.offset;
  }, [items, memoryKey]);

  // switching preview (or search on/off): put the list back exactly as it was left
  useLayoutEffect(() => {
    scroller.current!.scrollTop = scrollMemory[memoryKey] ?? 0;
    rememberScroll();
  }, [memoryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // a selection made in the page: scroll the panel to its row
  useLayoutEffect(() => {
    if (!reveal || reveal.sid !== sid) return;
    const i = items.findIndex((it) => it.kind === "row" && it.row.id === reveal.id);
    const el = scroller.current!;
    if (i >= 0 && (i * ROW_H < el.scrollTop || (i + 1) * ROW_H > el.scrollTop + el.clientHeight)) el.scrollTop = i * ROW_H - el.clientHeight / 2;
  }, [reveal?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hovering an element in the page highlights its row, or the nearest visible ancestor row. Nothing expands.
  const shown = new Set(items.filter((i) => i.kind === "row").map((i) => i.key));
  const hoverRow = hover ? [...hover.chain].reverse().find((id) => shown.has(id)) : undefined;

  const ctx = { region: "layers" as const, screenId: sid };
  const onKeyDown = safe(ctx, (e: React.KeyboardEvent) => {
    const rows = items.filter((i): i is Extract<Item, { kind: "row" }> => i.kind === "row");
    const last = sel[sel.length - 1];
    const at = rows.findIndex((r) => r.row.id === last);
    const cur = rows[at];
    const go = (r?: (typeof rows)[number]) => { if (r) selectFromRow(sid, r.row.id, false); };
    if (e.key === "ArrowDown") go(rows[at + 1] ?? (at < 0 ? rows[0] : undefined));
    else if (e.key === "ArrowUp") go(rows[at - 1]);
    else if (e.key === "ArrowRight" && cur && !searching) {
      if (!cur.row.has) return;
      if (!tree.open[cur.row.id]) toggleOpen(sid, cur.row.id);
      else go(rows[at + 1]?.parent === cur.row.id ? rows[at + 1] : undefined); // first child, if it has loaded
    } else if (e.key === "ArrowLeft" && cur && !searching) {
      if (tree.open[cur.row.id]) toggleOpen(sid, cur.row.id);
      else go(rows.find((r) => r.row.id === cur.parent));
    } else return;
    e.preventDefault();
  });

  return (
    <>
      <div className="search-wrap">
        <input className="search" placeholder="Search layers" value={tree.query} onChange={(e) => setSearch(sid, e.target.value)} />
      </div>
      <div className="rows" tabIndex={0} ref={scroller} onScroll={rememberScroll} onKeyDown={onKeyDown}>
        {searching && !tree.found && <div className="row muted">Searching…</div>}
        {searching && tree.found?.length === 0 && <div className="row muted">No matches</div>}
        {!searching && !tree.kids[""] && tree.load[""] === "loading" && <div className="row muted">Loading…</div>}
        {items.map((it) => {
          const pad = { paddingLeft: 8 + it.depth * 14 };
          if (it.kind === "loading") return <div key={it.key} className="row muted" style={pad}>Loading…</div>;
          if (it.kind === "error") return (
            <div key={it.key} className="row error" style={pad}>Couldn't load <button onClick={() => loadKids(sid, it.parent)}>Retry</button></div>
          );
          const row = it.row;
          return (
            <div
              key={it.key}
              className={"row" + (sel.includes(row.id) ? " selected" : "") + (hoverRow === row.id ? " hovered" : "")}
              style={pad}
              onMouseEnter={() => hoverFromRow(sid, row.id)}
              onMouseLeave={clearHover}
              onClick={(e) => selectFromRow(sid, row.id, e.shiftKey)}
            >
              <span className="chev" onClick={(e) => { e.stopPropagation(); if (row.has && !searching) toggleOpen(sid, row.id); }}>
                {row.has && !searching ? (tree.open[row.id] ? "▾" : "▸") : ""}
              </span>
              <span className="name">{row.name}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
