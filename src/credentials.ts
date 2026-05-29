import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
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

// Body credenziali in upload non valido/incompleto (-> 400).
export class CredentialsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsValidationError";
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

export async function writeCredentials(creds: CredentialsFile): Promise<void> {
  await mkdir(path.dirname(credentialsPath), { recursive: true });
  const tmp = `${credentialsPath}.tmp`;
  await writeFile(tmp, JSON.stringify(creds, null, 2), "utf8");
  await rename(tmp, credentialsPath);
}

// Salva credenziali ricevute da remoto. Accetta o l'intero file
// ({ claudeAiOauth: {...}, organizationUuid? }) o direttamente un oggetto
// claudeAiOauth. Valida accessToken+refreshToken (senza refresh il container
// muore al primo scadere). Ritorna SOLO metadati non sensibili.
export async function saveCredentials(
  input: unknown,
): Promise<{ expiresAt: number | undefined; scopes: string[] | undefined }> {
  if (!input || typeof input !== "object") {
    throw new CredentialsValidationError("Body credenziali assente o non valido.");
  }
  const obj = input as Record<string, unknown>;
  // Se ha la chiave claudeAiOauth lo trattiamo come file completo, altrimenti
  // assumiamo sia direttamente l'oggetto claudeAiOauth.
  const hasWrapper =
    obj.claudeAiOauth && typeof obj.claudeAiOauth === "object";
  const oauth = (hasWrapper ? obj.claudeAiOauth : obj) as Record<string, unknown>;

  if (typeof oauth.accessToken !== "string" || !oauth.accessToken) {
    throw new CredentialsValidationError("Credenziali incomplete: 'accessToken' mancante.");
  }
  if (typeof oauth.refreshToken !== "string" || !oauth.refreshToken) {
    throw new CredentialsValidationError(
      "Credenziali incomplete: 'refreshToken' mancante (necessario per l'auto-refresh).",
    );
  }

  const claudeAiOauth: ClaudeOAuth = {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0,
    scopes: Array.isArray(oauth.scopes) ? (oauth.scopes as string[]) : undefined,
    subscriptionType:
      typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : undefined,
    rateLimitTier:
      typeof oauth.rateLimitTier === "string" ? oauth.rateLimitTier : undefined,
  };

  const creds: CredentialsFile = { claudeAiOauth };
  if (hasWrapper && typeof obj.organizationUuid === "string") {
    creds.organizationUuid = obj.organizationUuid;
  }

  await writeCredentials(creds);
  return { expiresAt: claudeAiOauth.expiresAt, scopes: claudeAiOauth.scopes };
}

// Stato delle credenziali correnti, senza esporre i token.
export async function credentialsStatus(): Promise<{
  present: boolean;
  expiresAt?: number;
  expired?: boolean;
  scopes?: string[];
}> {
  let creds: CredentialsFile;
  try {
    creds = await readCredentials();
  } catch {
    return { present: false };
  }
  const { expiresAt, scopes } = creds.claudeAiOauth;
  return {
    present: true,
    expiresAt,
    expired: typeof expiresAt === "number" ? expiresAt - Date.now() <= 0 : undefined,
    scopes,
  };
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
