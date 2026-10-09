import { memo, useCallback, useEffect, useRef } from "react";
import {
  LABEL_H, PREVIEW_H, PREVIEW_W, cellOf, clearHover, clearSelection, clickAt, loadScreens, mountIframe, panBy, probeHover,
  retryPreview, wheelPage, zoomAt,
} from "./host";
import { ErrorBox, Region } from "./Region";
import { safe, type Ctx } from "./failures";
import { get, update, useStore, type Box, type Screen } from "./store";

const boardCtx: Ctx = { region: "board", screenId: null };
const previewCtx = (sid: string): Ctx => ({ region: "preview", screenId: sid });
const NONE: string[] = [];

// ---- the iframes. They sit in a layer that is scaled by CSS, and nothing else is drawn in it. ----
const Preview = memo(function Preview({ screen, index }: { screen: Screen; index: number }) {
  const p = useStore((s) => s.previews[screen.id]);
  const ref = useCallback((el: HTMLIFrameElement | null) => mountIframe(screen.id, el), [screen.id]);
  const c = cellOf(index);
  const src = p?.broken ? new URL("/__no-agent__.html", screen.url).toString() : screen.url; // dev: a page without our script
  return (
    <div className="cell" style={{ left: c.x, top: c.y }}>
      <div className="cell-label" style={{ height: LABEL_H }}>{screen.name}</div>
      {/* No allow-top-navigation: a page can't navigate the board. */}
      <iframe key={p?.attempt} ref={ref} title={screen.name} src={src} width={PREVIEW_W} height={PREVIEW_H} sandbox="allow-scripts allow-same-origin allow-forms" />
    </div>
  );
});

// ---- everything the app draws goes in this layer, in real screen pixels, so 1px and 2px stay 1px and 2px ----
const LABEL_PX = 18;

function Outline({ box, z, kind, label }: { box: Box | null | undefined; z: number; kind: "hover" | "selected"; label: boolean }) {
  if (!box) return null; // not there (yet)
  const labelTop = box.y * z - LABEL_PX >= 0 ? box.y * z - LABEL_PX : (box.y + box.h) * z; // below when there is no room above
  return (
    <>
      <div className={`box ${kind}`} style={{ left: box.x * z, top: box.y * z, width: box.w * z, height: box.h * z, borderWidth: kind === "hover" ? 1 : 2 }} />
      {label && <div className={`tag ${kind}`} style={{ left: Math.max(0, box.x * z), top: labelTop }}>{box.name}</div>}
    </>
  );
}

function Outlines({ sid, z }: { sid: string; z: number }) {
  const mode = useStore((s) => s.mode);
  const sel = useStore((s) => (s.sel?.sid === sid ? s.sel.ids : NONE));
  const hover = useStore((s) => (s.hover?.sid === sid ? s.hover.id : null));
  const boxes = useStore((s) => s.boxes[sid]);
  const drawFault = useStore((s) => s.dev.draw === sid); // dev menu: fail while drawing
  if (drawFault) throw new Error(`Dev: simulated error while drawing outlines (${sid})`);
  if (mode !== "select") return null; // Interact mode: nothing is drawn. The selection is kept.
  return (
    <>
      {hover && !sel.includes(hover) && <Outline box={boxes?.[hover]} z={z} kind="hover" label />}
      {sel.map((id) => <Outline key={id} box={boxes?.[id]} z={z} kind="selected" label />)}
    </>
  );
}

/** Select mode: a transparent sheet over the iframe. Clicks land here, so the page never sees them. */
function ClickCatcher({ sid }: { sid: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const k = r.width / PREVIEW_W; // screen px per page px
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };
  const ctx = previewCtx(sid);
  return (
    <div
      ref={ref}
      className="catcher"
      onPointerMove={safe(ctx, (e: React.PointerEvent) => { const p = pos(e); probeHover(sid, p.x, p.y); })}
      onPointerLeave={safe(ctx, clearHover)}
      onPointerDown={() => document.getElementById("board")?.focus({ preventScroll: true })}
      onClick={safe(ctx, (e: React.MouseEvent) => { const p = pos(e); return clickAt(sid, p.x, p.y, e.shiftKey); })}
    />
  );
}

function Frame({ screen, index }: { screen: Screen; index: number }) {
  const sid = screen.id;
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const p = useStore((s) => s.previews[sid]);
  const error = useStore((s) => s.errors[`preview:${sid}`]);
  const c = cellOf(index);
  if (!p) return null;
  return (
    <div className="frame" data-frame={sid} style={{ left: view.x + c.x * view.z, top: view.y + (c.y + LABEL_H) * view.z, width: PREVIEW_W * view.z, height: PREVIEW_H * view.z }}>
      {mode === "select" && !error && <ClickCatcher sid={sid} />}
      <Region ctx={previewCtx(sid)} quiet onRetry={() => retryPreview(sid)}>
        <Outlines sid={sid} z={view.z} />
      </Region>
      {p.pageError && (
        <div className="page-badge" tabIndex={0}>
          Page error{p.pageError.count > 1 ? ` ×${p.pageError.count}` : ""}
          <span className="tip">{p.pageError.message}</span>
        </div>
      )}
      {!p.ready && !error && <div className="loading">Loading…</div>}
      {error && <div className="preview-error"><ErrorBox message={error} onRetry={() => retryPreview(sid)} /></div>}
    </div>
  );
}

export function Board() {
  const ref = useRef<HTMLDivElement>(null);
  const screens = useStore((s) => s.screens);
  const view = useStore((s) => s.view);
  const boardError = useStore((s) => s.errors.board);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // The wheel needs a non-passive listener so we can stop the browser from scrolling or zooming the page.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = safe(boardCtx, (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        return zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY * unit); // anywhere, even over a preview
      }
      let dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      const frame = (e.target as HTMLElement).closest<HTMLElement>("[data-frame]");
      if (frame && get().mode === "select") {
        const r = frame.getBoundingClientRect();
        const k = r.width / PREVIEW_W;
        return wheelPage(frame.dataset.frame!, (e.clientX - r.left) / k, (e.clientY - r.top) / k, dx / k, dy / k);
      }
      panBy(-dx, -dy);
    });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Dragging empty board space pans. A click without a drag clears the selection.
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-frame], button") || e.button !== 0) return; // a preview or a Retry button handles its own pointer
    ref.current!.setPointerCapture(e.pointerId);
    ref.current!.focus({ preventScroll: true });
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const move = safe(boardCtx, (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3)) return;
    panBy(e.clientX - d.x, e.clientY - d.y);
    Object.assign(d, { x: e.clientX, y: e.clientY, moved: true });
  });
  const up = safe(boardCtx, () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) clearSelection();
  });

  return (
    <div id="board" ref={ref} className="board" tabIndex={-1} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => !drag.current && clearHover()}>
      {!screens && !boardError && <div className="center">Loading screens…</div>}
      {boardError && !screens && <div className="center"><ErrorBox message={boardError} onRetry={() => { update((s) => { delete s.errors.board; }); loadScreens(); }} /></div>}
      {screens && (
        <>
          <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {screens.map((s, i) => <Preview key={s.id} screen={s} index={i} />)}
          </div>
          <div className="screen-layer">
            {screens.map((s, i) => <Frame key={s.id} screen={s} index={i} />)}
          </div>
          {boardError && <div className="board-banner"><ErrorBox message={boardError} onRetry={() => update((s) => { delete s.errors.board; })} /></div>}
        </>
      )}
    </div>
  );
}
