import {
  BASE_URL,
  OAUTH_BETA,
  ANTHROPIC_VERSION,
  HAIKU_MODEL,
} from "./config.js";

export class UpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export interface UsageWindow {
  utilization: number;
  resets_at: string;
}

export interface RawUsage {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  extra_usage?: {
    is_enabled: boolean;
    monthly_limit: number;
    used_credits: number;
    utilization: number;
    currency: string;
    disabled_reason: string | null;
  } | null;
  [key: string]: unknown;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": OAUTH_BETA,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
}

// Esegue una richiesta verso l'API Anthropic e ne ritorna il JSON,
// trasformando le risposte non-2xx in UpstreamError.
async function request<T>(
  path: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // fetch() rigetta solo per errori di rete (DNS, connessione, TLS): il
    // motivo reale e' in err.cause, che altrimenti resterebbe nascosto dietro
    // il generico "fetch failed".
    throw new UpstreamError(0, `${label}: ${describeFetchError(url, err)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new UpstreamError(
      res.status,
      `${label} (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return JSON.parse(text) as T;
}

// Estrae una descrizione leggibile da un errore di rete di fetch(), inclusa
// la causa sottostante (es. ENOTFOUND, ECONNREFUSED, ETIMEDOUT).
export function describeFetchError(url: string, err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return `${base} -> ${code ? `${code}: ` : ""}${cause.message} (${url})`;
  }
  return `${base} (${url})`;
}

export async function getUsage(token: string): Promise<RawUsage> {
  return request<RawUsage>(
    "/api/oauth/usage",
    { headers: authHeaders(token) },
    "Errore endpoint usage",
  );
}

export interface PingResult {
  model: string;
  id: string;
  stop_reason: string | null;
}

export async function ping(token: string): Promise<PingResult> {
  const data = await request<{
    id: string;
    model: string;
    stop_reason: string | null;
  }>(
    "/v1/messages",
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1,
        system: "You are Claude Code, Anthropic's official CLI for Claude.",
        messages: [{ role: "user", content: "ping" }],
      }),
    },
    "Errore ping",
  );
  return { id: data.id, model: data.model, stop_reason: data.stop_reason };
}
