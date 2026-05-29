import { Router, type Request, type Response, type NextFunction } from "express";
import { getValidAccessToken } from "../credentials.js";
import { ping, getUsage } from "../anthropic.js";

export const pingRouter = Router();

pingRouter.post("/ping", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await getValidAccessToken();
    const result = await ping(token);
    const usage = await getUsage(token);
    res.json({
      pinged: true,
      model: result.model,
      message_id: result.id,
      five_hour: usage.five_hour,
    });
  } catch (err) {
    next(err);
  }
});
