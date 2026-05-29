import { Router, type Request, type Response, type NextFunction } from "express";
import { getValidAccessToken } from "../credentials.js";
import { getUsage, type UsageWindow } from "../anthropic.js";

export const usageRouter = Router();

interface NormalizedWindow {
  utilization: number;
  resets_at: string;
  resets_in_seconds: number;
}

function normalize(w: UsageWindow | null | undefined): NormalizedWindow | null {
  if (!w) return null;
  const resetMs = new Date(w.resets_at).getTime();
  return {
    utilization: w.utilization,
    resets_at: w.resets_at,
    resets_in_seconds: Math.max(0, Math.round((resetMs - Date.now()) / 1000)),
  };
}

usageRouter.get("/usage", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await getValidAccessToken();
    const raw = await getUsage(token);
    res.json({
      fetched_at: new Date().toISOString(),
      five_hour: normalize(raw.five_hour),
      seven_day: normalize(raw.seven_day),
      seven_day_opus: normalize(raw.seven_day_opus),
      seven_day_sonnet: normalize(raw.seven_day_sonnet),
      extra_usage: raw.extra_usage ?? null,
    });
  } catch (err) {
    next(err);
  }
});

usageRouter.get("/usage/5h", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await getValidAccessToken();
    const raw = await getUsage(token);
    res.json({
      fetched_at: new Date().toISOString(),
      five_hour: normalize(raw.five_hour),
    });
  } catch (err) {
    next(err);
  }
});

usageRouter.get("/usage/weekly", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await getValidAccessToken();
    const raw = await getUsage(token);
    res.json({
      fetched_at: new Date().toISOString(),
      seven_day: normalize(raw.seven_day),
    });
  } catch (err) {
    next(err);
  }
});
