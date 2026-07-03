#!/usr/bin/env node
// Uploads the local PC's Claude Code OAuth credentials to a remote
// claudiometro instance (e.g. the container on the NAS).
//
// Usage:
//   node scripts/push-credentials.mjs http://NAS:4317 [admin-token]
//
// The admin token can be passed as the 2nd argument or via the env var
// CLAUDIOMETRO_ADMIN_TOKEN. The credentials file is read from
// CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude/.credentials.json).
//
// It never prints the tokens: only the outcome (expiresAt, scopes).

import "dotenv/config";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function fail(msg) {
  console.error("Error: " + msg);
  process.exit(1);
}

const base = (process.argv[2] || "").replace(/\/$/, "");
const token = process.argv[3] || process.env.CLAUDIOMETRO_ADMIN_TOKEN || "";

if (!base) {
  fail(
    "missing destination URL.\n" +
      "Usage: node scripts/push-credentials.mjs http://NAS:4317 [admin-token]",
  );
}
if (!token) {
  fail(
    "missing admin token. Pass it as the 2nd argument or via CLAUDIOMETRO_ADMIN_TOKEN.",
  );
}

const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const credPath = path.join(configDir, ".credentials.json");

let raw;
try {
  raw = await readFile(credPath, "utf8");
} catch {
  fail(`credentials file not found at ${credPath}. Log in with the Claude Code CLI.`);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  fail(`credentials file is not valid JSON: ${credPath}`);
}

if (!parsed?.claudeAiOauth?.refreshToken) {
  fail("the local credentials do not contain a refreshToken: cannot proceed.");
}

const res = await fetch(`${base}/admin/credentials`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(parsed),
}).catch((e) => fail(`request failed: ${e.message}`));

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

if (!res.ok) {
  fail(`HTTP ${res.status}: ${body.error || text}`);
}

console.log("Credentials uploaded successfully to " + base);
if (body.expiresAt) {
  console.log("  expires: " + new Date(body.expiresAt).toLocaleString());
}
if (body.scopes) {
  console.log("  scopes: " + body.scopes.join(", "));
}
