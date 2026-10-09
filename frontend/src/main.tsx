import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installSafetyNet } from "./failures";
import { initHost } from "./host";
import { get, update } from "./store";
import "./styles.css";

installSafetyNet();
initHost();
// Dev only: lets tests and the console reach the store (window.__board.get()).
if (import.meta.env.DEV) (window as unknown as { __board: unknown }).__board = { get, update };
// No <StrictMode>: it runs effects twice in development, which would double every request and report.
createRoot(document.getElementById("root")!).render(<App />);
