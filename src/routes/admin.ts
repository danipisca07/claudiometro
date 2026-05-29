import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../auth.js";
import {
  saveCredentials,
  credentialsStatus,
  CredentialsValidationError,
} from "../credentials.js";

export const adminRouter = Router();

// POST /admin/credentials — carica/aggiorna le credenziali OAuth da remoto.
adminRouter.post(
  "/admin/credentials",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { expiresAt, scopes } = await saveCredentials(req.body);
      res.json({ ok: true, expiresAt, scopes });
    } catch (err) {
      if (err instanceof CredentialsValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
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
