import { useEffect, useState } from "react";
import { apiUrl, getJson, isDetails, type Details } from "./api";
import { raise } from "./failures";
import { ErrorBox, Region } from "./Region";
import { get, update, useStore } from "./store";

const FIELDS: [string, string][] = [
  ["name", "Name"], ["tag", "Tag"], ["id", "Id"], ["classes", "Classes"], ["size", "Size (px)"], ["position", "Position"],
  ["text", "Text"], ["color", "Text colour"], ["background", "Background"], ["fontFamily", "Font family"], ["fontSize", "Font size"], ["fontWeight", "Font weight"],
];

export function Inspector() {
  const sid = useStore((s) => s.sel?.sid ?? s.active);
  return (
    <aside className="panel inspector">
      <div className="panel-head">Inspector</div>
      <Region ctx={{ region: "inspector", screenId: sid }} onRetry={() => update((s) => { s.dev.inspector = false; })}>
        <Body />
      </Region>
    </aside>
  );
}

function Body() {
  const sel = useStore((s) => s.sel);
  const gone = useStore((s) => s.gone);
  const lives = useStore((s) => s.lives);
  const crash = useStore((s) => s.dev.inspector);
  if (crash) throw new Error("Dev: simulated inspector render error");

  if (!sel) return <div className="empty">{gone ? "This element no longer exists" : "Select an element"}</div>;
  const infos = sel.ids.map((id) => lives[sel.sid]?.[id]).filter((x) => !!x);
  if (!infos.length) return <div className="empty">Loading…</div>;
  const many = infos.length > 1;

  return (
    <div className="inspector-body">
      {many && <div className="multi">{infos.length} elements</div>}
      <h3>Live</h3>
      <dl>
        {FIELDS.map(([key, label]) => {
          const values = new Set(infos.map((i) => i[key]));
          const mixed = values.size > 1; // "Mixed" when the selected elements disagree
          return (
            <div className="field" key={key}>
              <dt>{label}</dt>
              <dd className={mixed ? "mixed" : ""}>{mixed ? "Mixed" : infos[0][key] || "—"}</dd>
            </div>
          );
        })}
      </dl>
      {!many && <DetailsSection sid={sel.sid} dkey={infos[0].key} />}
    </div>
  );
}

type Result = { kind: "loading" | "nokey" | "notfound" } | { kind: "ok"; d: Details } | { kind: "error"; message: string };

function DetailsSection({ sid, dkey }: { sid: string; dkey: string }) {
  const [result, setResult] = useState<Result>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!dkey) return setResult({ kind: "nokey" });
    setResult({ kind: "loading" });
    const abort = new AbortController();
    let current = true; // false once the selection changed or this section went away
    (async () => {
      try {
        const url = apiUrl("/elements/" + encodeURIComponent(dkey), get().dev.detailsFail ? 1 : undefined);
        const { status, body } = await getJson(url, abort.signal);
        if (!current) return;
        if (status === 404) return setResult({ kind: "notfound" }); // not an error
        if (!isDetails(body)) throw new Error("The server sent bad data");
        setResult({ kind: "ok", d: body });
      } catch (e) {
        if (!current) return; // cancelled because the user moved on: no error, no report
        raise({ region: "details", screenId: sid, elementKey: dkey }, e);
        setResult({ kind: "error", message: e instanceof Error ? e.message : "Unknown error" });
      }
    })();
    return () => { current = false; abort.abort(); };
  }, [sid, dkey, attempt]);

  return (
    <>
      <h3>Details</h3>
      {result.kind === "loading" && <div className="muted">Loading…</div>}
      {result.kind === "nokey" && <div className="muted">No details</div>}
      {result.kind === "notfound" && <div className="muted">No details for this element</div>}
      {result.kind === "error" && <ErrorBox message={`Couldn't load details. ${result.message}`} onRetry={() => setAttempt((a) => a + 1)} />}
      {result.kind === "ok" && (
        <dl>
          {(["component", "description", "status", "owner"] as const).map((k) => (
            <div className="field" key={k}><dt>{k[0].toUpperCase() + k.slice(1)}</dt><dd>{result.d[k]}</dd></div>
          ))}
        </dl>
      )}
    </>
  );
}
