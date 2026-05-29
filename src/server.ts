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
import { initScheduler, ScheduleError } from "./scheduler.js";

const app = express();
app.use(express.json());

// Permissive CORS: le API sono esposte solo su LAN, nessuna autenticazione.
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

// Serve la webapp statica (frontend/) sulla root.
const frontendDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "frontend",
);
app.use(express.static(frontendDir));

// Gestione centralizzata degli errori: mappa ogni errore di dominio sul suo
// status HTTP. Le route si limitano a propagare con next(err).
const errorStatus = (err: unknown): number => {
  if (err instanceof TokenExpiredError) return 401;
  if (err instanceof CredentialsValidationError) return 400;
  if (err instanceof ScheduleError) return 400;
  if (err instanceof UpstreamError) return 502;
  return 500;
};

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = errorStatus(err);
  const message = err instanceof Error ? err.message : "Errore interno";
  // Log completo lato server (incluse causa e stack) per il debug; al client
  // mandiamo solo il messaggio.
  console.error(`[${status}] ${req.method} ${req.path}:`, err);
  if (err instanceof Error && err.cause) {
    console.error("  cause:", err.cause);
  }
  res.status(status).json({ error: message });
});

initScheduler().catch((err) => {
  console.error("Errore inizializzazione scheduler:", err);
});

app.listen(config.port, () => {
  console.log(`claudiometro in ascolto su http://localhost:${config.port}`);
  console.log(
    `auto-refresh token: ${config.disableRefresh ? "DISABILITATO" : "abilitato"}`,
  );
});
