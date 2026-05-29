import { Router, type Request, type Response, type NextFunction } from "express";
import { getValidAccessToken } from "../credentials.js";
import { getUsage, type RawUsage, type UsageWindow } from "../anthropic.js";

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

async function loadUsage(): Promise<RawUsage> {
  return getUsage(await getValidAccessToken());
}

// Costruisce un handler che recupera l'usage e ne ritorna solo le finestre
// selezionate dal `shape`, con un timestamp `fetched_at` comune.
function usageHandler(
  shape: (raw: RawUsage) => Record<string, unknown>,
) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = await loadUsage();
      res.json({ fetched_at: new Date().toISOString(), ...shape(raw) });
    } catch (err) {
      next(err);
    }
  };
}

usageRouter.get(
  "/usage",
  usageHandler((raw) => ({
    five_hour: normalize(raw.five_hour),
    seven_day: normalize(raw.seven_day),
    seven_day_opus: normalize(raw.seven_day_opus),
    seven_day_sonnet: normalize(raw.seven_day_sonnet),
    extra_usage: raw.extra_usage ?? null,
  })),
);

usageRouter.get(
  "/usage/5h",
  usageHandler((raw) => ({ five_hour: normalize(raw.five_hour) })),
);

usageRouter.get(
  "/usage/weekly",
  usageHandler((raw) => ({ seven_day: normalize(raw.seven_day) })),
);
