import { Router, type Request, type Response, type NextFunction } from "express";
import { getValidAccessToken } from "../credentials.js";
import { ping, getUsage } from "../anthropic.js";
import {
  schedulePing,
  listScheduled,
  cancelScheduled,
  getDailyRules,
  addDailyRule,
  updateDailyRule,
  deleteDailyRule,
} from "../scheduler.js";

export const pingRouter = Router();

// POST /ping
//   optional body: { at?: ISO8601 } or { delay_seconds?: number }
//   - absent / in the past   -> immediate ping (default)
//   - in the future (max 3d) -> store and send on time
pingRouter.post("/ping", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { at?: unknown; delay_seconds?: unknown };
    let runAt: Date | null = null;

    if (typeof body.at === "string" && body.at.trim()) {
      runAt = new Date(body.at);
      if (Number.isNaN(runAt.getTime())) {
        res.status(400).json({ error: "Invalid 'at' parameter (use ISO 8601)." });
        return;
      }
    } else if (typeof body.delay_seconds === "number" && body.delay_seconds > 0) {
      runAt = new Date(Date.now() + body.delay_seconds * 1000);
    }

    // Immediate if unspecified or if the time is within 1s from now.
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

    // A ScheduleError (e.g. beyond the 3-day limit) is mapped to 400 by the
    // central error handler via next(err).
    const item = await schedulePing(runAt);
    res.status(202).json({
      pinged: false,
      scheduled: true,
      id: item.id,
      run_at: item.run_at,
    });
  } catch (err) {
    next(err);
  }
});

pingRouter.get("/ping/scheduled", (_req: Request, res: Response) => {
  res.json({ scheduled: listScheduled() });
});

// GET /ping/daily — all recurring-ping rules (+ computed next_run each).
pingRouter.get("/ping/daily", (_req: Request, res: Response) => {
  res.json({ daily: getDailyRules() });
});

// POST /ping/daily — add a recurring daily ping.
//   body: { enabled: boolean, hour: 0-23, minute: 0-59 } (local time)
// Invalid hour/minute throw ScheduleError -> 400 via the central handler.
pingRouter.post(
  "/ping/daily",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as {
        enabled?: unknown;
        hour?: unknown;
        minute?: unknown;
      };
      const rule = await addDailyRule({
        enabled: body.enabled,
        hour: body.hour,
        minute: body.minute,
      });
      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /ping/daily/:id — update an existing recurring daily ping.
pingRouter.put(
  "/ping/daily/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as {
        enabled?: unknown;
        hour?: unknown;
        minute?: unknown;
      };
      const rule = await updateDailyRule(req.params.id, {
        enabled: body.enabled,
        hour: body.hour,
        minute: body.minute,
      });
      if (!rule) {
        res.status(404).json({ error: "Daily ping not found." });
        return;
      }
      res.json(rule);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /ping/daily/:id — remove a recurring daily ping.
pingRouter.delete(
  "/ping/daily/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ok = await deleteDailyRule(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Daily ping not found." });
        return;
      }
      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  },
);

pingRouter.delete(
  "/ping/scheduled/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ok = await cancelScheduled(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Ping not found or no longer cancelable." });
        return;
      }
      res.json({ canceled: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  },
);
