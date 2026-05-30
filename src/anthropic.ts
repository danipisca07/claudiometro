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

// Performs a request to the Anthropic API and returns its JSON, turning
// non-2xx responses into an UpstreamError.
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
    // fetch() only rejects on network errors (DNS, connection, TLS): the real
    // reason is in err.cause, which would otherwise stay hidden behind the
    // generic "fetch failed".
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

// Extracts a readable description from a fetch() network error, including
// the underlying cause (e.g. ENOTFOUND, ECONNREFUSED, ETIMEDOUT).
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
    "Usage endpoint error",
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
    "Ping error",
  );
  return { id: data.id, model: data.model, stop_reason: data.stop_reason };
}
