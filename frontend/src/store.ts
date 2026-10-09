// All app state lives in this one store. Components only read it; the functions in host.ts change it.
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export type Screen = { id: string; name: string; url: string };
export type Row = { id: string; name: string; key: string | null; has: boolean };
export type Box = { x: number; y: number; w: number; h: number; name: string };
export type Live = Record<string, string>;

/** The layers tree of one preview. `kids[""]` is the children of <body>. */
export type Tree = {
  kids: Record<string, Row[]>;
  load: Record<string, "loading" | "error">;
  open: Record<string, boolean>;
  query: string;
  found: (Row & { depth: number })[] | null; // search result, flat, ancestors included
};

/** Switches for the dev menu. Each one is consumed when it fires. */
export type Dev = {
  connectMs: number;
  detailsFail: boolean;
  layers: boolean;
  inspector: boolean;
  draw: string | null;
  click: string | null;
  message: string | null;
  response: string | null;
  key: boolean;
  dropChildren: string | null;
};

export type State = {
  screens: Screen[] | null;
  errors: Record<string, string>; // region errors: "board", "preview:<id>", "layers", "inspector"
  view: { x: number; y: number; z: number };
  mode: "select" | "interact";
  active: string | null; // the preview the layers panel and inspector show
  sel: { sid: string; ids: string[] } | null; // selection is always inside one preview
  gone: boolean; // the selected element(s) disappeared
  hover: { sid: string; id: string; chain: string[] } | null; // one element on the whole board
  previews: Record<string, { attempt: number; ready: boolean; broken?: boolean; pageError?: { message: string; count: number } }>;
  trees: Record<string, Tree>;
  boxes: Record<string, Record<string, Box | null>>; // outline geometry, sent by each page
  lives: Record<string, Record<string, Live>>; // inspector values, sent by each page
  reveal: { sid: string; id: string; n: number } | null; // "scroll the layers panel to this row"
  dev: Dev;
};

export const MIN_Z = 0.25;
export const MAX_Z = 4;

export const noDev: Dev = {
  connectMs: 10000, detailsFail: false, layers: false, inspector: false,
  draw: null, click: null, message: null, response: null, key: false, dropChildren: null,
};

export const newTree = (): Tree => ({ kids: {}, load: {}, open: {}, query: "", found: null });

export const useStore = create<State>()(
  immer<State>(() => ({
    screens: null, errors: {}, view: { x: 24, y: 24, z: MIN_Z }, mode: "select", active: null, sel: null,
    gone: false, hover: null, previews: {}, trees: {}, boxes: {}, lives: {}, reveal: null, dev: noDev,
  })),
);

export const get = useStore.getState;
export const update = (fn: (s: State) => void) => useStore.setState(fn);
