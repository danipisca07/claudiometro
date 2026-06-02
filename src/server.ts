import { fileURLToPath } from "node:url";
import path from "node:path";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { config } from "./config.js";
import { TokenExpiredError, CredentialsValidationError } from "./credentials.js";
import { UpstreamError } from "./anthropic.js";
import { usageRouter } from "./routes/usage.js";
import { pingRouter } from "./routes/ping.js";
import { adminRouter } from "./routes/admin.js";
import { initScheduler, initDailyPing, ScheduleError } from "./scheduler.js";

const app = express();
app.use(express.json());

// Permissive CORS: the APIs are exposed on the LAN only, no authentication.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.use(usageRouter);
app.use(pingRouter);
app.use(adminRouter);

// Serve the static webapp (frontend/) at the root.
const frontendDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "frontend",
);
app.use(express.static(frontendDir));

// Centralized error handling: maps every domain error to its HTTP status.
// Routes simply propagate with next(err).
const errorStatus = (err: unknown): number => {
  if (err instanceof TokenExpiredError) return 401;
  if (err instanceof CredentialsValidationError) return 400;
  if (err instanceof ScheduleError) return 400;
  if (err instanceof UpstreamError) return 502;
  return 500;
};

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = errorStatus(err);
  const message = err instanceof Error ? err.message : "Internal error";
  // Full server-side log (including cause and stack) for debugging; we only
  // send the message to the client.
  console.error(`[${status}] ${req.method} ${req.path}:`, err);
  if (err instanceof Error && err.cause) {
    console.error("  cause:", err.cause);
  }
  res.status(status).json({ error: message });
});

initScheduler().catch((err) => {
  console.error("Scheduler initialization error:", err);
});

initDailyPing().catch((err) => {
  console.error("Daily ping initialization error:", err);
});

app.listen(config.port, () => {
  console.log(`claudiometro listening on http://localhost:${config.port}`);
  console.log(
    `token auto-refresh: ${config.disableRefresh ? "DISABLED" : "enabled"}`,
  );
});
