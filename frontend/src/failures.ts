// Every failure goes through raise(): it is reported once and shown in its own region only.
import { report } from "../report.js";
import { get, update } from "./store";

export type Ctx = {
  region: "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";
  screenId: string | null;
  elementKey?: string;
};

/** A request that was cancelled or replaced because the user moved on. Not a failure. */
export class Cancelled extends Error {}
export class Timeout extends Error {}

const reported = new WeakSet<object>();
const recent = new Map<string, number>(); // message -> time it was reported

export const errorKey = (c: Ctx) => (c.region === "preview" ? `preview:${c.screenId}` : c.region);
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Report an error unless it is a cancellation or was already reported. Returns false if it did not report. */
export function reportOnly(ctx: Ctx, error: unknown): boolean {
  if (error instanceof Cancelled) return false;
  const err = error instanceof Error ? error : new Error(String(error));
  if (reported.has(err)) return false;
  reported.add(err);
  recent.set(err.message, Date.now());
  report(err, { region: ctx.region, screenId: ctx.screenId, ...(ctx.elementKey ? { elementKey: ctx.elementKey } : {}) });
  return true;
}

/** Report once, and show the error in its region (board, preview, layers panel, inspector). */
export function raise(ctx: Ctx, error: unknown, shown?: string) {
  if (!reportOnly(ctx, error)) return;
  if (["board", "preview", "layers", "inspector"].includes(ctx.region)) {
    update((s) => { s.errors[errorKey(ctx)] = shown ?? messageOf(error); });
  }
}

/** Wrap any handler, callback or timer so that an error in it becomes a region error. */
export function safe<A extends unknown[]>(ctx: Ctx, fn: (...a: A) => unknown) {
  return (...args: A) => {
    try {
      const out = fn(...args);
      if (out instanceof Promise) out.catch((e) => raise(ctx, e));
    } catch (e) {
      raise(ctx, e);
    }
  };
}

/** Dev menu: throw once if that fault is armed. */
export function maybeThrow(kind: "click" | "message" | "response", sid: string) {
  if (get().dev[kind] !== sid) return;
  update((s) => { s.dev[kind] = null; });
  throw new Error(`Dev: simulated error (${kind}) in ${sid}`);
}

/**
 * Anything that escapes all of the above is still reported once. In development React re-runs a failed
 * render and that fires a window "error" for a copy of an error we already handled, so we wait a moment
 * and skip errors whose message was just reported by a region.
 */
export function installSafetyNet() {
  const ctx: Ctx = { region: "board", screenId: null };
  const quiet = (e: unknown) => window.setTimeout(() => {
    if (Date.now() - (recent.get(messageOf(e)) ?? 0) > 1000) raise(ctx, e);
  }, 50);
  window.addEventListener("error", (e) => quiet(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => quiet(e.reason));
}
