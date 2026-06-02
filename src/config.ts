import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

function bool(v: string | undefined): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 4317,
  disableRefresh: bool(process.env.DISABLE_REFRESH),
  claudeConfigDir:
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  // Folder where runtime state is persisted (scheduled pings).
  dataDir:
    process.env.CLAUDIOMETRO_DATA_DIR || path.join(moduleDir, "..", "data"),
  // Secret for the /admin/* endpoints (remote credentials upload).
  // Empty = admin endpoints disabled (fail-closed).
  adminToken: process.env.CLAUDIOMETRO_ADMIN_TOKEN || "",
};

export const credentialsPath = path.join(
  config.claudeConfigDir,
  ".credentials.json",
);

export const scheduledPingsPath = path.join(
  config.dataDir,
  "scheduled-pings.json",
);

export const dailyPingPath = path.join(config.dataDir, "daily-ping.json");

// Maximum scheduling horizon for a ping: 3 days.
export const MAX_SCHEDULE_MS = 3 * 24 * 60 * 60 * 1000;

// Anthropic / Claude Code OAuth constants
export const BASE_URL = "https://api.anthropic.com";
export const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
// Public OAuth client id used by the Claude Code CLI.
export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const OAUTH_BETA = "oauth-2025-04-20";
export const ANTHROPIC_VERSION = "2023-06-01";
export const HAIKU_MODEL = "claude-haiku-4-5";

// Refresh token if it expires within this many ms.
export const REFRESH_SKEW_MS = 60_000;
