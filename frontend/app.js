const API_BASE = (window.CLAUDIOMETRO_API_BASE || "").replace(/\/$/, "");
const POLL_SECONDS = Number(window.CLAUDIOMETRO_POLL_SECONDS) || 0;

const $ = (id) => document.getElementById(id);

function setStatus(msg, isError) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
}

function fmtReset(seconds) {
  if (seconds == null) return "reset --";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `reset tra ${h}h ${m}m`;
  if (m > 0) return `reset tra ${m}m`;
  return "reset imminente";
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
    resetEl.textContent = "reset --";
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
  const util = extra.utilization ?? 0;
  $("fill-extra").style.width = `${Math.min(100, util)}%`;
  $("fill-extra").style.background = colorFor(util);
  $("util-extra").textContent = `${util}%`;
  $("extra-detail").textContent =
    `${extra.used_credits} / ${extra.monthly_limit} ${extra.currency}`;
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
      "aggiornato " + new Date().toLocaleTimeString("it-IT");
    setStatus("ok");
  } catch (err) {
    setStatus("errore: " + err.message, true);
  }
}

async function doPing() {
  const btn = $("pingBtn");
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "Ping in corso...";
  try {
    const res = await fetch(`${API_BASE}/ping`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    setStatus("ping inviato — finestra 5h avviata");
    await loadUsage();
  } catch (err) {
    setStatus("ping fallito: " + err.message, true);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
}

$("refreshBtn").addEventListener("click", loadUsage);
$("pingBtn").addEventListener("click", doPing);

$("api-base-label").textContent = "API: " + (API_BASE || "(stesso host)");

loadUsage();
if (POLL_SECONDS > 0) {
  setInterval(loadUsage, POLL_SECONDS * 1000);
}
