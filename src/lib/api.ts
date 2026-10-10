export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const apiOrigin = (import.meta.env.VITE_CRM_API_URL || "").replace(/\/$/, "");
const sessionStorageKey = "snowenduro.crm.session";

export function getApiAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiOrigin}${path}`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(sessionStorageKey);
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${apiOrigin}/api${path}`, {
    ...init,
    credentials: "omit",
    headers,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Ошибка сервера (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  if (path === "/auth/login" || path === "/auth/setup") {
    const session = payload as { token?: unknown } | null;
    if (typeof session?.token === "string") {
      sessionStorage.setItem(sessionStorageKey, session.token);
    }
  }
  if (path === "/auth/logout") sessionStorage.removeItem(sessionStorageKey);
  if (path === "/auth/status") {
    const status = payload as { authenticated?: unknown } | null;
    if (!status?.authenticated) sessionStorage.removeItem(sessionStorageKey);
  }
  if (response.status === 401 && path !== "/auth/login" && path !== "/auth/setup") {
    sessionStorage.removeItem(sessionStorageKey);
  }
  return payload as T;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
