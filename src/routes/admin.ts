import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../auth.js";
import { saveCredentials, credentialsStatus } from "../credentials.js";

export const adminRouter = Router();

// POST /admin/credentials — carica/aggiorna le credenziali OAuth da remoto.
// Una CredentialsValidationError viene mappata a 400 dall'error handler centrale.
adminRouter.post(
  "/admin/credentials",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { expiresAt, scopes } = await saveCredentials(req.body);
      res.json({ ok: true, expiresAt, scopes });
    } catch (err) {
      next(err);
    }
  },
);

// GET /admin/credentials/status — stato credenziali (senza token).
adminRouter.get(
  "/admin/credentials/status",
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await credentialsStatus());
    } catch (err) {
      next(err);
    }
  },
);
