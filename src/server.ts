import { fileURLToPath } from "node:url";
import path from "node:path";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { config } from "./config.js";
import { TokenExpiredError } from "./credentials.js";
import { UpstreamError } from "./anthropic.js";
import { usageRouter } from "./routes/usage.js";
import { pingRouter } from "./routes/ping.js";

const app = express();
app.use(express.json());

// Permissive CORS: le API sono esposte solo su LAN, nessuna autenticazione.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
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

// Serve la webapp statica (frontend/) sulla root.
const frontendDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "frontend",
);
app.use(express.static(frontendDir));

// Centralized error handler.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof TokenExpiredError) {
    res.status(401).json({ error: err.message });
    return;
  }
  if (err instanceof UpstreamError) {
    res.status(502).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Errore interno";
  res.status(500).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`claudiometro in ascolto su http://localhost:${config.port}`);
  console.log(
    `auto-refresh token: ${config.disableRefresh ? "DISABILITATO" : "abilitato"}`,
  );
});
