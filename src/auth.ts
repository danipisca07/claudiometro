import { timingSafeEqual } from "node:crypto";
import { type Request, type Response, type NextFunction } from "express";
import { config } from "./config.js";

// Constant-time comparison of two strings.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Protects the /admin/* endpoints.
// Fail-closed: if CLAUDIOMETRO_ADMIN_TOKEN is not set, the endpoint is disabled.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminToken) {
    res.status(503).json({
      error: "Admin endpoint disabled: set CLAUDIOMETRO_ADMIN_TOKEN.",
    });
    return;
  }

  const header = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = match?.[1]?.trim();

  if (!provided || !safeEqual(provided, config.adminToken)) {
    res.status(401).json({ error: "Missing or invalid admin token." });
    return;
  }

  next();
}
