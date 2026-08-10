import type { ApiErrorBody } from "../shared/contracts.js";

export class ClientApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.set("X-Astrava-Request", "wallet-auth");
  }

  let response: Response;
  try {
    const signal = init.signal ?? AbortSignal.timeout(8_000);
    response = await fetch(path, {
      ...init,
      headers,
      signal,
      credentials: "same-origin"
    });
  } catch {
    throw new ClientApiError("NETWORK_ERROR", "AstravaQuant is temporarily unreachable.", 0);
  }

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    throw new ClientApiError(
      body?.error.code ?? "REQUEST_FAILED",
      body?.error.message ?? "AstravaQuant could not complete this request.",
      response.status
    );
  }

  return (await response.json()) as T;
}
