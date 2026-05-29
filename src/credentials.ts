import { readFile, writeFile, rename } from "node:fs/promises";
import {
  config,
  credentialsPath,
  OAUTH_TOKEN_URL,
  OAUTH_CLIENT_ID,
  REFRESH_SKEW_MS,
} from "./config.js";

export interface ClaudeOAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

export interface CredentialsFile {
  claudeAiOauth: ClaudeOAuth;
  organizationUuid?: string;
  [key: string]: unknown;
}

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenExpiredError";
  }
}

async function readCredentials(): Promise<CredentialsFile> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath, "utf8");
  } catch {
    throw new TokenExpiredError(
      `File credenziali non trovato in ${credentialsPath}. Esegui il login con la CLI Claude Code.`,
    );
  }
  const parsed = JSON.parse(raw) as CredentialsFile;
  if (!parsed.claudeAiOauth?.accessToken) {
    throw new TokenExpiredError(
      "Credenziali OAuth Claude Code assenti o malformate.",
    );
  }
  return parsed;
}

async function writeCredentials(creds: CredentialsFile): Promise<void> {
  const tmp = `${credentialsPath}.tmp`;
  await writeFile(tmp, JSON.stringify(creds, null, 2), "utf8");
  await rename(tmp, credentialsPath);
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshAccessToken(
  creds: CredentialsFile,
): Promise<CredentialsFile> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: creds.claudeAiOauth.refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new TokenExpiredError(
      `Refresh del token fallito (${res.status}): ${body.slice(0, 300)}. Rinnova con la CLI Claude Code.`,
    );
  }

  const data = (await res.json()) as RefreshResponse;
  const updated: CredentialsFile = {
    ...creds,
    claudeAiOauth: {
      ...creds.claudeAiOauth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? creds.claudeAiOauth.refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : creds.claudeAiOauth.expiresAt,
    },
  };
  await writeCredentials(updated);
  return updated;
}

export async function getValidAccessToken(): Promise<string> {
  const creds = await readCredentials();
  const { accessToken, expiresAt } = creds.claudeAiOauth;

  if (expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return accessToken;
  }

  if (config.disableRefresh) {
    throw new TokenExpiredError(
      "Token OAuth scaduto e auto-refresh disabilitato (DISABLE_REFRESH). Rinnova con la CLI Claude Code.",
    );
  }

  const refreshed = await refreshAccessToken(creds);
  return refreshed.claudeAiOauth.accessToken;
}

export async function getOrganizationUuid(): Promise<string | undefined> {
  const creds = await readCredentials();
  return creds.organizationUuid;
}
