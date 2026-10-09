const API = "http://localhost:4000";
const params = new URLSearchParams(location.search);

/** `?latency=800&fail=0.3` on the app's URL is forwarded to every API call. */
export function apiUrl(path: string, fail?: number): string {
  const u = new URL(path, API);
  for (const k of ["latency", "fail"]) if (params.get(k)) u.searchParams.set(k, params.get(k)!);
  if (fail !== undefined) u.searchParams.set("fail", String(fail));
  return u.toString();
}

/** 404 gives { status: 404 }. Any other failure, including a malformed body, throws. */
export async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { signal });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    throw new Error("The server sent a malformed response");
  }
}

export type Details = { component: string; description: string; status: string; owner: string };
export const isDetails = (b: any): b is Details => !!b && ["component", "description", "status", "owner"].every((k) => typeof b[k] === "string");
export const isScreens = (b: any): boolean => Array.isArray(b) && b.every((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.url === "string");
