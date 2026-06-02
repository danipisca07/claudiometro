const API_BASE = (window.CLAUDIOMETRO_API_BASE || "").replace(/\/$/, "");
const POLL_SECONDS = Number(window.CLAUDIOMETRO_POLL_SECONDS) || 0;

const $ = (id) => document.getElementById(id);

function setStatus(msg, isError) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
}

function fmtReset(seconds) {
  if (seconds == null) return "resets --";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `resets in ${h}h ${m}m`;
  if (m > 0) return `resets in ${m}m`;
  return "resetting soon";
}

function colorFor(util) {
  if (util >= 90) return "var(--danger)";
  if (util >= 70) return "var(--warn)";
  return "var(--ok)";
}

function renderWindow(prefix, w) {
  const util = w ? w.utilization : null;
  const fill = $(`fill-${prefix}`);
  const utilEl = $(`util-${prefix}`);
  const resetEl = $(`reset-${prefix}`);
  if (util == null) {
    fill.style.width = "0%";
    utilEl.textContent = "--%";
    resetEl.textContent = "resets --";
    return;
  }
  fill.style.width = `${Math.min(100, util)}%`;
  fill.style.background = colorFor(util);
  utilEl.textContent = `${util}%`;
  resetEl.textContent = fmtReset(w.resets_in_seconds);
}

function renderExtra(extra) {
  const card = $("card-extra");
  if (!extra || !extra.is_enabled) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  // The API reports amounts in minor units (cents) and leaves `utilization`
  // null, so we convert to the main currency unit and derive the percentage
  // ourselves against the configured monthly spending limit.
  const limit = extra.monthly_limit / 100;
  const used = extra.used_credits / 100;
  const util = limit > 0 ? Math.round((used / limit) * 100) : 0;
  $("fill-extra").style.width = `${Math.min(100, util)}%`;
  $("fill-extra").style.background = colorFor(util);
  $("util-extra").textContent = `${util}%`;
  $("extra-detail").textContent =
    `${used.toFixed(2)} / ${limit.toFixed(2)} ${extra.currency}`;
}

async function loadUsage() {
  try {
    const res = await fetch(`${API_BASE}/usage`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderWindow("5h", data.five_hour);
    renderWindow("weekly", data.seven_day);
    renderExtra(data.extra_usage);
    $("updated").textContent =
      "updated " + new Date().toLocaleTimeString();
    setStatus("ok");
  } catch (err) {
    setStatus("error: " + err.message, true);
  }
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL = {
  pending: "pending",
  done: "sent",
  failed: "failed",
  canceled: "canceled",
};

function renderScheduled(list) {
  const card = $("card-scheduled");
  const ul = $("scheduled-list");
  if (!list || list.length === 0) {
    card.hidden = true;
    ul.innerHTML = "";
    return;
  }
  card.hidden = false;
  ul.innerHTML = "";
  for (const item of list) {
    const li = document.createElement("li");
    li.className = "sched-item";

    const info = document.createElement("span");
    info.className = "sched-when";
    info.textContent = fmtDateTime(item.run_at);

    const badge = document.createElement("span");
    badge.className = "sched-badge sched-" + item.status;
    badge.textContent = STATUS_LABEL[item.status] || item.status;
    if (item.status === "failed" && item.error) badge.title = item.error;

    li.append(info, badge);

    if (item.status === "pending") {
      const cancel = document.createElement("button");
      cancel.className = "sched-cancel";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => cancelScheduled(item.id, cancel));
      li.append(cancel);
    }
    ul.append(li);
  }
}

async function loadScheduled() {
  try {
    const res = await fetch(`${API_BASE}/ping/scheduled`);
    if (!res.ok) return;
    const data = await res.json();
    renderScheduled(data.scheduled);
  } catch {
    /* non-critical list: ignore transient network errors */
  }
}

async function cancelScheduled(id, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/ping/scheduled/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    setStatus("scheduled ping canceled");
    await loadScheduled();
  } catch (err) {
    setStatus("cancellation failed: " + err.message, true);
    btn.disabled = false;
  }
}

const pad2 = (n) => String(n).padStart(2, "0");

function renderDaily(rule) {
  $("daily-enabled").checked = !!rule.enabled;
  $("daily-time").value = `${pad2(rule.hour)}:${pad2(rule.minute)}`;
  const info = $("daily-info");
  const parts = [];
  if (rule.enabled && rule.next_run) {
    parts.push("next " + fmtDateTime(rule.next_run));
  } else {
    parts.push("disabled");
  }
  if (rule.last_run_at) {
    const last = rule.last_status === "failed" ? "failed" : "sent";
    parts.push(`last ${last} ${fmtDateTime(rule.last_run_at)}`);
    if (rule.last_status === "failed" && rule.last_error) {
      info.title = rule.last_error;
    }
  }
  info.textContent = parts.join(" · ");
}

async function loadDaily() {
  try {
    const res = await fetch(`${API_BASE}/ping/daily`);
    if (!res.ok) return;
    renderDaily(await res.json());
  } catch {
    /* non-critical: ignore transient network errors */
  }
}

async function saveDaily() {
  const time = $("daily-time").value || "09:00";
  const [hour, minute] = time.split(":").map((n) => Number(n));
  try {
    const res = await fetch(`${API_BASE}/ping/daily`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("daily-enabled").checked,
        hour,
        minute,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const rule = await res.json();
    renderDaily(rule);
    setStatus(
      rule.enabled
        ? "daily ping set for " + fmtDateTime(rule.next_run)
        : "daily ping disabled",
    );
  } catch (err) {
    setStatus("daily ping update failed: " + err.message, true);
    await loadDaily();
  }
}

async function doPing() {
  const btn = $("pingBtn");
  btn.disabled = true;
  const prev = btn.textContent;

  const atRaw = $("schedule-at").value;
  const body = {};
  if (atRaw) {
    // datetime-local is local time without a zone: new Date() reads it as local.
    body.at = new Date(atRaw).toISOString();
  }
  const isScheduled = !!body.at;
  btn.textContent = isScheduled ? "Scheduling..." : "Pinging...";

  try {
    const res = await fetch(`${API_BASE}/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.scheduled) {
      setStatus("ping scheduled for " + fmtDateTime(data.run_at));
      $("schedule-at").value = "";
      await loadScheduled();
    } else {
      setStatus("ping sent — 5h window started");
      await loadUsage();
    }
  } catch (err) {
    setStatus((isScheduled ? "scheduling failed: " : "ping failed: ") + err.message, true);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
}

function setScheduleBounds() {
  const input = $("schedule-at");
  const pad = (n) => String(n).padStart(2, "0");
  const toLocal = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const max = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  input.min = toLocal(now);
  input.max = toLocal(max);
}

$("refreshBtn").addEventListener("click", loadUsage);
$("pingBtn").addEventListener("click", doPing);
$("daily-enabled").addEventListener("change", saveDaily);
$("daily-time").addEventListener("change", saveDaily);

$("api-base-label").textContent = "API: " + (API_BASE || "(same host)");

setScheduleBounds();
loadUsage();
loadScheduled();
loadDaily();
if (POLL_SECONDS > 0) {
  setInterval(loadUsage, POLL_SECONDS * 1000);
  setInterval(loadScheduled, POLL_SECONDS * 1000);
  setInterval(loadDaily, POLL_SECONDS * 1000);
}
