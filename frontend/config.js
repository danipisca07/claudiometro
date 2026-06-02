// Default frontend config. When served by the claudiometro server, this file is
// overridden at runtime by the CLAUDIOMETRO_API_BASE / CLAUDIOMETRO_POLL_SECONDS
// environment variables (see the dynamic /config.js route). Editing the values
// here only matters when the page is served by some other static host.
//
// Base address of the claudiometro API.
// Leave an empty string ("") to use the same host that serves this page.
// To point at another host on the LAN, set e.g.: "http://192.168.1.50:4317"
window.CLAUDIOMETRO_API_BASE = "";

// How often (seconds) the webapp refreshes the gauges (polling). 0 = disable auto-refresh.
window.CLAUDIOMETRO_POLL_SECONDS = 30;
