import fs from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  config,
  scheduledPingsPath,
  dailyPingPath,
  MAX_SCHEDULE_MS,
} from "./config.js";
import { getValidAccessToken } from "./credentials.js";
import { ping } from "./anthropic.js";

export type PingStatus = "pending" | "done" | "failed" | "canceled";

export interface ScheduledPing {
  id: string;
  run_at: string;
  created_at: string;
  status: PingStatus;
  model?: string;
  message_id?: string;
  error?: string;
  fired_at?: string;
}

export class ScheduleError extends Error {}

const timers = new Map<string, NodeJS.Timeout>();
let items: ScheduledPing[] = [];

async function persist(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${scheduledPingsPath}.tmp`;
  await writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await rename(tmp, scheduledPingsPath);
}

async function runPing(id: string): Promise<void> {
  timers.delete(id);
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== "pending") return;
  try {
    const token = await getValidAccessToken();
    const result = await ping(token);
    item.status = "done";
    item.model = result.model;
    item.message_id = result.id;
  } catch (err) {
    item.status = "failed";
    item.error = err instanceof Error ? err.message : String(err);
  }
  item.fired_at = new Date().toISOString();
  await persist();
}

function arm(item: ScheduledPing): void {
  const delay = Math.max(0, new Date(item.run_at).getTime() - Date.now());
  const t = setTimeout(() => {
    void runPing(item.id);
  }, delay);
  if (typeof t.unref === "function") t.unref();
  timers.set(item.id, t);
}

export async function schedulePing(runAt: Date): Promise<ScheduledPing> {
  if (Number.isNaN(runAt.getTime())) {
    throw new ScheduleError("Invalid schedule date.");
  }
  if (runAt.getTime() - Date.now() > MAX_SCHEDULE_MS) {
    throw new ScheduleError(
      "A ping can be scheduled at most 3 days in the future.",
    );
  }
  const item: ScheduledPing = {
    id: randomUUID(),
    run_at: new Date(Math.max(runAt.getTime(), Date.now())).toISOString(),
    created_at: new Date().toISOString(),
    status: "pending",
  };
  items.push(item);
  await persist();
  arm(item);
  return item;
}

export function listScheduled(): ScheduledPing[] {
  return [...items].sort((a, b) => a.run_at.localeCompare(b.run_at));
}

export async function cancelScheduled(id: string): Promise<boolean> {
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== "pending") return false;
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  item.status = "canceled";
  await persist();
  return true;
}

export async function initScheduler(): Promise<void> {
  try {
    items = JSON.parse(fs.readFileSync(scheduledPingsPath, "utf8")) as ScheduledPing[];
  } catch {
    items = [];
  }
  // Prune outcomes older than 3 days so the file does not grow forever.
  const cutoff = Date.now() - MAX_SCHEDULE_MS;
  items = items.filter((i) => {
    if (i.status === "pending") return true;
    return new Date(i.fired_at || i.created_at).getTime() >= cutoff;
  });
  // Re-arm pending ones: those whose run_at already passed (server down) fire now.
  for (const item of items) {
    if (item.status === "pending") arm(item);
  }
  await persist();
}

// ---------------------------------------------------------------------------
// Recurring daily pings
//
// Any number of daily rules can be configured; each is a self-rearming timer
// that fires a ping every day at a local HH:MM. Rules are persisted to
// data/daily-ping.json as an array. Unlike one-shot pings, a daily run missed
// while the server was down is simply skipped; the next occurrence is armed on
// startup.
// ---------------------------------------------------------------------------

export interface DailyRule {
  id: string;
  enabled: boolean;
  hour: number; // 0–23, local time
  minute: number; // 0–59, local time
  last_run_at?: string;
  last_status?: "done" | "failed";
  last_error?: string;
}

export interface DailyRuleView extends DailyRule {
  next_run?: string;
}

let dailyRules: DailyRule[] = [];
const dailyTimers = new Map<string, NodeJS.Timeout>();

function computeNextDailyRun(hour: number, minute: number): Date {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function parseHourMinute(input: { hour: unknown; minute: unknown }): {
  hour: number;
  minute: number;
} {
  const hour = Number(input.hour);
  const minute = Number(input.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new ScheduleError("'hour' must be an integer between 0 and 23.");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new ScheduleError("'minute' must be an integer between 0 and 59.");
  }
  return { hour, minute };
}

function toDailyView(rule: DailyRule): DailyRuleView {
  const view: DailyRuleView = { ...rule };
  if (rule.enabled) {
    view.next_run = computeNextDailyRun(rule.hour, rule.minute).toISOString();
  }
  return view;
}

async function persistDaily(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${dailyPingPath}.tmp`;
  await writeFile(tmp, JSON.stringify(dailyRules, null, 2), "utf8");
  await rename(tmp, dailyPingPath);
}

async function runDailyPing(id: string): Promise<void> {
  const rule = dailyRules.find((r) => r.id === id);
  if (!rule) return;
  try {
    const token = await getValidAccessToken();
    await ping(token);
    rule.last_status = "done";
    rule.last_error = undefined;
  } catch (err) {
    rule.last_status = "failed";
    rule.last_error = err instanceof Error ? err.message : String(err);
  }
  rule.last_run_at = new Date().toISOString();
  await persistDaily();
}

function armDaily(rule: DailyRule): void {
  const existing = dailyTimers.get(rule.id);
  if (existing) {
    clearTimeout(existing);
    dailyTimers.delete(rule.id);
  }
  if (!rule.enabled) return;
  const delay = Math.max(
    0,
    computeNextDailyRun(rule.hour, rule.minute).getTime() - Date.now(),
  );
  const t = setTimeout(() => {
    void runDailyPing(rule.id).finally(() => {
      // The rule may have been deleted or disabled while the ping was running.
      const current = dailyRules.find((r) => r.id === rule.id);
      if (current && current.enabled) armDaily(current);
    });
  }, delay);
  if (typeof t.unref === "function") t.unref();
  dailyTimers.set(rule.id, t);
}

export function getDailyRules(): DailyRuleView[] {
  return dailyRules.map(toDailyView);
}

export async function addDailyRule(input: {
  enabled: unknown;
  hour: unknown;
  minute: unknown;
}): Promise<DailyRuleView> {
  const { hour, minute } = parseHourMinute(input);
  const rule: DailyRule = {
    id: randomUUID(),
    enabled: Boolean(input.enabled),
    hour,
    minute,
  };
  dailyRules.push(rule);
  await persistDaily();
  armDaily(rule);
  return toDailyView(rule);
}

export async function updateDailyRule(
  id: string,
  input: { enabled: unknown; hour: unknown; minute: unknown },
): Promise<DailyRuleView | null> {
  const rule = dailyRules.find((r) => r.id === id);
  if (!rule) return null;
  const { hour, minute } = parseHourMinute(input);
  rule.enabled = Boolean(input.enabled);
  rule.hour = hour;
  rule.minute = minute;
  await persistDaily();
  armDaily(rule);
  return toDailyView(rule);
}

export async function deleteDailyRule(id: string): Promise<boolean> {
  const idx = dailyRules.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const t = dailyTimers.get(id);
  if (t) {
    clearTimeout(t);
    dailyTimers.delete(id);
  }
  dailyRules.splice(idx, 1);
  await persistDaily();
  return true;
}

function normalizeStoredRule(stored: unknown): DailyRule | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<DailyRule>;
  return {
    id: typeof s.id === "string" && s.id ? s.id : randomUUID(),
    enabled: Boolean(s.enabled),
    hour: Number.isInteger(s.hour) ? (s.hour as number) : 9,
    minute: Number.isInteger(s.minute) ? (s.minute as number) : 0,
    last_run_at: s.last_run_at,
    last_status: s.last_status,
    last_error: s.last_error,
  };
}

export async function initDailyPing(): Promise<void> {
  try {
    const stored = JSON.parse(fs.readFileSync(dailyPingPath, "utf8")) as unknown;
    if (Array.isArray(stored)) {
      dailyRules = stored
        .map(normalizeStoredRule)
        .filter((r): r is DailyRule => r !== null);
    } else {
      // Migrate the legacy single-object format to a one-element array.
      const migrated = normalizeStoredRule(stored);
      dailyRules = migrated ? [migrated] : [];
    }
  } catch {
    dailyRules = [];
  }
  for (const rule of dailyRules) armDaily(rule);
  await persistDaily();
}
