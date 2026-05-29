import { timingSafeEqual } from "node:crypto";
import { type Request, type Response, type NextFunction } from "express";
import { config } from "./config.js";

// Confronto a tempo costante di due stringhe.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Protegge gli endpoint /admin/*.
// Fail-closed: se CLAUDIOMETRO_ADMIN_TOKEN non è impostato l'endpoint è disabilitato.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminToken) {
    res.status(503).json({
      error: "Endpoint admin disabilitato: imposta CLAUDIOMETRO_ADMIN_TOKEN.",
    });
    return;
  }

  const header = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = match?.[1]?.trim();

  if (!provided || !safeEqual(provided, config.adminToken)) {
    res.status(401).json({ error: "Token admin mancante o non valido." });
    return;
  }

  next();
}
