#!/usr/bin/env node
// Carica le credenziali OAuth di Claude Code dal PC locale verso un'istanza
// remota di claudiometro (es. il container sul NAS).
//
// Uso:
//   node scripts/push-credentials.mjs http://NAS:4317 [admin-token]
//
// Il token admin puo essere passato come 2o argomento oppure via env
// CLAUDIOMETRO_ADMIN_TOKEN. Il file credenziali viene letto da
// CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude/.credentials.json).
//
// Non stampa mai i token: solo l'esito (expiresAt, scopes).

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function fail(msg) {
  console.error("Errore: " + msg);
  process.exit(1);
}

const base = (process.argv[2] || "").replace(/\/$/, "");
const token = process.argv[3] || process.env.CLAUDIOMETRO_ADMIN_TOKEN || "";

if (!base) {
  fail(
    "manca l'URL di destinazione.\n" +
      "Uso: node scripts/push-credentials.mjs http://NAS:4317 [admin-token]",
  );
}
if (!token) {
  fail(
    "manca il token admin. Passalo come 2o argomento o via CLAUDIOMETRO_ADMIN_TOKEN.",
  );
}

const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const credPath = path.join(configDir, ".credentials.json");

let raw;
try {
  raw = await readFile(credPath, "utf8");
} catch {
  fail(`file credenziali non trovato in ${credPath}. Fai login con la CLI Claude Code.`);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  fail(`file credenziali non e JSON valido: ${credPath}`);
}

if (!parsed?.claudeAiOauth?.refreshToken) {
  fail("le credenziali locali non contengono un refreshToken: impossibile procedere.");
}

const res = await fetch(`${base}/admin/credentials`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(parsed),
}).catch((e) => fail(`richiesta fallita: ${e.message}`));

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

console.log("Credenziali caricate con successo su " + base);
if (body.expiresAt) {
  console.log("  scade: " + new Date(body.expiresAt).toLocaleString());
}
if (body.scopes) {
  console.log("  scopes: " + body.scopes.join(", "));
}
