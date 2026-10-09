// Dev only: triggers each failure from R6 on demand. "Aimed" ones hit the active preview (or the first).
import { useState } from "react";
import { devBreakPreview, devThrowInPage, devThrowInTimer, loadScreens } from "./host";
import { update, useStore, type Dev } from "./store";

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const screens = useStore((s) => s.screens);
  const active = useStore((s) => s.active);
  const dev = useStore((s) => s.dev);
  const sid = active ?? screens?.[0]?.id ?? null;
  const arm = <K extends keyof Dev>(k: K, v: Dev[K]) => update((s) => { s.dev[k] = v; });
  const aimed = (label: string, run: (sid: string) => void) => <button disabled={!sid} onClick={() => sid && run(sid)}>{label}</button>;

  return (
    <div className="dev">
      <button onClick={() => setOpen(!open)}>Dev ▾</button>
      {open && (
        <div className="dev-menu">
          <div className="muted">Aimed at: {screens?.find((s) => s.id === sid)?.name ?? "—"}</div>
          <h4>Regions</h4>
          <button onClick={() => loadScreens(1)}>Board: GET /screens fails</button>
          {aimed("Preview: can't connect (no script)", devBreakPreview)}
          <label>Connect timeout{" "}
            <select value={dev.connectMs} onChange={(e) => arm("connectMs", Number(e.target.value))}>
              <option value={10000}>10 s</option><option value={2000}>2 s</option>
            </select>
          </label>
          {aimed("Preview: throw an error inside the page", devThrowInPage)}
          <label><input type="checkbox" checked={dev.detailsFail} onChange={(e) => arm("detailsFail", e.target.checked)} /> Details: GET /elements fails</label>
          {aimed("Layers row: page ignores next expand (3 s)", (id) => arm("dropChildren", id))}
          <button onClick={() => arm("layers", true)}>Layers panel: render error</button>
          <button onClick={() => arm("inspector", true)}>Inspector: render error</button>
          <h4>An error thrown…</h4>
          {aimed("…while drawing outlines", (id) => arm("draw", id))}
          {aimed("…in the next click handler (then click it)", (id) => arm("click", id))}
          <button onClick={() => arm("key", true)}>…in the next key handler (press any shortcut)</button>
          {aimed("…handling the next message from the page", (id) => arm("message", id))}
          {aimed("…when the next response arrives (then hover)", (id) => arm("response", id))}
          {aimed("…in a timer", devThrowInTimer)}
        </div>
      )}
    </div>
  );
}
