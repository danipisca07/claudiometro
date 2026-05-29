import { Router, type Request, type Response, type NextFunction } from "express";
import { getValidAccessToken } from "../credentials.js";
import { ping, getUsage } from "../anthropic.js";
import {
  schedulePing,
  listScheduled,
  cancelScheduled,
  ScheduleError,
} from "../scheduler.js";

export const pingRouter = Router();

// POST /ping
//   body opzionale: { at?: ISO8601 } oppure { delay_seconds?: number }
//   - assente / nel passato  -> ping immediato (default)
//   - nel futuro (max 3gg)    -> salva e invia a tempo
pingRouter.post("/ping", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { at?: unknown; delay_seconds?: unknown };
    let runAt: Date | null = null;

    if (typeof body.at === "string" && body.at.trim()) {
      runAt = new Date(body.at);
      if (Number.isNaN(runAt.getTime())) {
        res.status(400).json({ error: "Parametro 'at' non valido (usa ISO 8601)." });
        return;
      }
    } else if (typeof body.delay_seconds === "number" && body.delay_seconds > 0) {
      runAt = new Date(Date.now() + body.delay_seconds * 1000);
    }

    // Immediato se non specificato o se l'orario è entro 1s da adesso.
    if (!runAt || runAt.getTime() <= Date.now() + 1000) {
      const token = await getValidAccessToken();
      const result = await ping(token);
      const usage = await getUsage(token);
      res.json({
        pinged: true,
        scheduled: false,
        model: result.model,
        message_id: result.id,
        five_hour: usage.five_hour,
      });
      return;
    }

    try {
      const item = await schedulePing(runAt);
      res.status(202).json({
        pinged: false,
        scheduled: true,
        id: item.id,
        run_at: item.run_at,
      });
    } catch (e) {
      if (e instanceof ScheduleError) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

pingRouter.get("/ping/scheduled", (_req: Request, res: Response) => {
  res.json({ scheduled: listScheduled() });
});

pingRouter.delete(
  "/ping/scheduled/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ok = await cancelScheduled(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Ping non trovato o non più annullabile." });
        return;
      }
      res.json({ canceled: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  },
);
