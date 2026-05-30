import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../auth.js";
import { saveCredentials, credentialsStatus } from "../credentials.js";

export const adminRouter = Router();

// POST /admin/credentials — uploads/updates the OAuth credentials remotely.
// A CredentialsValidationError is mapped to 400 by the central error handler.
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

// GET /admin/credentials/status — credentials status (without tokens).
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
