import { Board } from "./Board";
import { DevMenu } from "./DevMenu";
import { setMode } from "./host";
import { Inspector } from "./Inspector";
import { LayersPanel } from "./Layers";
import { useStore } from "./store";

export function App() {
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => s.view.z);
  return (
    <div className="app">
      <header className="toolbar">
        <strong>Board</strong>
        <span className="seg">
          <button aria-pressed={mode === "select"} onClick={() => setMode("select")}>Select <kbd>V</kbd></button>
          <button aria-pressed={mode === "interact"} onClick={() => setMode("interact")}>Interact <kbd>I</kbd></button>
        </span>
        <span className="muted">{Math.round(zoom * 100)}%</span>
        <span className="spacer" />
        {import.meta.env.DEV && <DevMenu />}
      </header>
      <main className="main">
        <LayersPanel />
        <Board />
        <Inspector />
      </main>
    </div>
  );
}
