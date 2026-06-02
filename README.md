# Claudiometro

A small self-hosted monitor for **Claude Code** usage. It shows your **5-hour** and
**weekly** rate-limit windows (and extra credits, if your account has them) in a simple
web dashboard, backed by a local HTTP API.

Claudiometro reuses the OAuth credentials that the Claude Code CLI already stores on your
machine (`~/.claude/.credentials.json`) to read usage from Anthropic's endpoint — the same
numbers you see from `/usage` in the CLI. It also has a **"Ping Haiku"** button that fires a
cheap request to the Haiku model to start (or refresh) your 5-hour window on demand.

> ⚠️ **Built for local / LAN use.** There is **no real authentication** on the usage
> endpoints and CORS is wide open. Do **not** expose this server to the public internet.
> See [Security](#security) below.

## What it shows

- **5-hour window** — percentage used and time until reset.
- **Weekly window (7 days)** — percentage used and time until reset.
- **Extra credits** (if enabled on your account) — usage and credits spent.

## Requirements

- Node.js 18+ (20+ recommended).
- You must have logged in at least once with the Claude Code CLI, so that
  `~/.claude/.credentials.json` exists.
  On Windows that's `C:\Users\<user>\.claude\.credentials.json`.

## Quick start

```bash
npm install
npm run dev          # hot-reload dev server
```

Then open <http://localhost:4317/>. The dashboard auto-refreshes every 30 seconds.

For production:

```bash
npm run build        # compile TypeScript to dist/
npm start            # node dist/server.js
```

A single Express process serves **both** the API and the static web app on the same port
(default `4317`).

## Configuration

Environment variables (via a `.env` file or the system environment — see `.env.example`):

| Variable                   | Default     | Description                                                              |
|----------------------------|-------------|--------------------------------------------------------------------------|
| `PORT`                     | `4317`      | HTTP server port.                                                        |
| `DISABLE_REFRESH`          | `0`         | Set to `1`/`true` to disable OAuth token auto-refresh (expired → 401).   |
| `CLAUDE_CONFIG_DIR`        | `~/.claude` | Override the Claude Code config directory.                               |
| `CLAUDIOMETRO_DATA_DIR`    | `./data`    | Where scheduled pings are persisted.                                     |
| `CLAUDIOMETRO_ADMIN_TOKEN` | _(empty)_   | Secret for the `/admin/*` endpoints. Empty = admin endpoints disabled (fail-closed). |
| `CLAUDIOMETRO_POLL_SECONDS`| `30`        | Dashboard auto-refresh interval in seconds. `0` disables it.             |
| `CLAUDIOMETRO_API_BASE`    | _(empty)_   | Frontend API base URL. Empty = same host serving the page. For another LAN host: `http://192.168.1.50:4317`. |

The frontend reads `CLAUDIOMETRO_POLL_SECONDS` / `CLAUDIOMETRO_API_BASE` through a
dynamic `/config.js` served from these environment variables, overriding the
committed `frontend/config.js` (which only acts as a fallback default when the
page is hosted by some other static server).

## API

| Method | Path                          | Response                                                            |
|--------|-------------------------------|---------------------------------------------------------------------|
| GET    | `/health`                     | `{ "ok": true }`                                                    |
| GET    | `/usage`                      | All normalized windows + `extra_usage` + `fetched_at`.              |
| GET    | `/usage/5h`                   | The 5-hour window only.                                             |
| GET    | `/usage/weekly`               | The weekly window only.                                             |
| POST   | `/ping`                       | Ping Haiku **now** (default) or **schedule** it for later.          |
| GET    | `/ping/scheduled`             | List scheduled pings (pending + recent results).                    |
| DELETE | `/ping/scheduled/:id`         | Cancel a pending ping.                                              |
| POST   | `/admin/credentials`          | **(admin)** Upload/update OAuth credentials remotely.               |
| GET    | `/admin/credentials/status`   | **(admin)** Credential status (presence, expiry) — never the tokens. |

Each window is normalized as `{ utilization, resets_at, resets_in_seconds }`.

### Scheduling a ping

`POST /ping` takes an optional JSON body:

- `{ }` or no body → ping immediately (default).
- `{ "at": "2026-05-31T14:30:00Z" }` → schedule at that ISO 8601 instant.
- `{ "delay_seconds": 3600 }` → schedule N seconds from now.

Limit: **at most 3 days in the future** (otherwise `400`). Times in the past are treated as
immediate. Scheduled pings are **persisted to disk** (`data/scheduled-pings.json`) and
reloaded on startup, so if the server was off at the scheduled time the ping fires on the
next start. A scheduled ping returns `202 { scheduled: true, id, run_at }`.

```bash
curl http://localhost:4317/usage
curl -X POST http://localhost:4317/ping                       # ping now
curl -X POST http://localhost:4317/ping \
  -H "Content-Type: application/json" -d '{"delay_seconds": 3600}'
curl http://localhost:4317/ping/scheduled
curl -X DELETE http://localhost:4317/ping/scheduled/<id>
```

## Running on an always-on host (Docker)

The point of running Claudiometro in a container on an always-on box (a NAS, a Raspberry Pi,
a small home server) is that usage tracking and scheduled pings keep working even when your
PC is off. The container has no credentials of its own — you provide them with a persistent
volume and/or by uploading them remotely via the admin API.

A `Dockerfile` and `docker-compose.yml` are included. With Compose:

```bash
# .env next to docker-compose.yml
CLAUDIOMETRO_ADMIN_TOKEN=<a-long-random-secret>

docker compose up -d --build
```

Two bind-mounts are used:

| Host         | Container | Contents                                   |
|--------------|-----------|--------------------------------------------|
| `./config`   | `/config` | `.credentials.json` (the OAuth credentials) |
| `./data`     | `/data`   | `scheduled-pings.json` (scheduled pings)    |

### Uploading credentials from your PC

After logging in with the Claude Code CLI on your PC, run:

```bash
node scripts/push-credentials.mjs http://HOST:4317 <CLAUDIOMETRO_ADMIN_TOKEN>
```

The script reads `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`) and does
`POST /admin/credentials` with `Authorization: Bearer <token>`. It never prints tokens —
only the result (`expiresAt`, `scopes`). The `./config` volume can start **empty**: until
you push, the container has no credentials (`/usage` → `401`,
`/admin/credentials/status` → `{ present: false }`); the bind-mount only **persists** them
across restarts. When credentials stop working (refresh expired/rotated), just re-run the
script.

### Try it locally (no remote host)

You can verify the whole flow on your PC by running the container **without** mounting the
credentials volume (so it starts "empty", like a freshly configured server):

```bash
docker build -t claudiometro:test .
docker run -d --name claudiometro-test -p 4317:4317 \
  -e CLAUDIOMETRO_ADMIN_TOKEN=secret claudiometro:test

curl http://localhost:4317/usage                                   # 401
curl -H "Authorization: Bearer secret" \
  http://localhost:4317/admin/credentials/status                   # { "present": false }

node scripts/push-credentials.mjs http://localhost:4317 secret
curl http://localhost:4317/usage/5h                                # 200

docker rm -f claudiometro-test
```

### Caveat: refresh-token rotation

On each refresh Anthropic **may** return a new `refresh_token` (single-use). If the
always-on host and your PC's CLI both refresh starting from the same token, one of them can
get invalidated. Suggestions: let the always-on host own the refresh; if your PC's
credentials stop working, log in again with the CLI and re-push; or set `DISABLE_REFRESH=1`
on one side to avoid the conflict.

## Security

Claudiometro is intentionally **not** hardened — it's a local/LAN convenience tool, and
security is deliberately minimal:

- The usage endpoints have **no authentication** and CORS is fully open.
- Credentials and tokens travel **in clear text** over HTTP.
- It reads (and the admin endpoint writes) your Claude Code OAuth tokens on disk.

Because of that:

- Run it only on a **trusted local network**. **Never** port-forward it or otherwise expose
  it to the public internet. For remote access, put it behind a VPN or a reverse proxy with
  TLS and real auth.
- The admin endpoints are **fail-closed**: they're disabled unless you set
  `CLAUDIOMETRO_ADMIN_TOKEN`, the token is compared in constant time, and responses never
  echo the tokens back — but this is the bare minimum, not a substitute for proper auth.
- Never commit `.credentials.json` or the `data/` directory (they contain tokens; `data/`
  is git-ignored).

The usage endpoint (`/api/oauth/usage`) is **not** publicly documented by Anthropic and may
change with CLI updates; it's isolated in `src/anthropic.ts` to make it easy to update.

## Contributing

Contributions are very welcome — issues, bug reports, and pull requests alike. If you're
planning a larger change, opening an issue first to discuss it is appreciated. Please keep
changes focused and run `npm run build` / `npm run typecheck` before submitting.

## License

Released under the **GNU General Public License v3.0**. See [LICENSE](LICENSE) for the full
text.
