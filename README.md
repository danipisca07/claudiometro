# Claudiometro

Monitor dell'utilizzo di **Claude Code** (finestre di rate-limit a 5 ore e settimanale)
con una webapp e delle API HTTP locali.

L'app riusa le credenziali OAuth già presenti sulla macchina
(`~/.claude/.credentials.json`) — quelle con cui hai fatto login con la CLI di Claude Code —
per leggere l'utilizzo dall'endpoint ufficiale Anthropic e mostrarlo in dei gauge.
Include anche un pulsante "Ping Haiku" per avviare la finestra delle 5 ore con una
chiamata a basso costo verso il modello Haiku.

> Pensata per uso **locale / LAN**: nessuna autenticazione, CORS permissivo.
> Non esporre il server su internet pubblico.

## Cosa mostra

- **Finestra 5 ore** — percentuale consumata e tempo al reset.
- **Finestra settimanale (7 giorni)** — percentuale consumata e tempo al reset.
- **Crediti extra** (se abilitati sul tuo account) — utilizzo e crediti spesi.

I valori coincidono con quelli del comando `/usage` nella CLI di Claude Code.

## Requisiti

- Node.js 18+ (consigliato 20+).
- Aver fatto login almeno una volta con la CLI di Claude Code, così che esista
  `~/.claude/.credentials.json`. Su Windows: `C:\Users\<utente>\.claude\.credentials.json`.

## Installazione

```bash
npm install
```

Opzionale: copia il file di esempio per personalizzare la configurazione.

```bash
cp .env.example .env
```

## Come lanciare le API + la webapp

Il server Express serve **sia le API che la webapp statica** sulla stessa porta
(default `4317`). Non servono due processi separati.

### Sviluppo (hot-reload)

```bash
npm run dev
```

### Produzione

```bash
npm run build   # compila TypeScript in dist/
npm start       # avvia node dist/server.js
```

Poi apri il browser su:

```
http://localhost:4317/
```

La webapp si aggiorna da sola ogni 30 secondi (configurabile in `frontend/config.js`).

## Configurazione

Variabili d'ambiente (file `.env` o env di sistema):

| Variabile           | Default     | Descrizione                                                                 |
|---------------------|-------------|-----------------------------------------------------------------------------|
| `PORT`              | `4317`      | Porta del server HTTP.                                                       |
| `DISABLE_REFRESH`   | `0`         | A `1`/`true` disabilita l'auto-refresh del token OAuth (token scaduto → 401).|
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Override della cartella di config di Claude Code.                            |

Lato frontend (`frontend/config.js`):

| Variabile                       | Default      | Descrizione                                              |
|---------------------------------|--------------|----------------------------------------------------------|
| `CLAUDIOMETRO_API_BASE`         | `""`         | Base URL delle API. Vuoto = stesso host che serve la pagina. Per puntare a un altro host in LAN: `"http://192.168.1.50:4317"`. |
| `CLAUDIOMETRO_POLL_SECONDS`     | `30`         | Intervallo di auto-refresh dei gauge. `0` = disabilita.  |

## Endpoint API

| Metodo | Path             | Risposta                                                                 |
|--------|------------------|--------------------------------------------------------------------------|
| GET    | `/health`        | `{ "ok": true }`                                                         |
| GET    | `/usage`         | Tutte le finestre normalizzate + `extra_usage` + `fetched_at`.           |
| GET    | `/usage/5h`      | Solo la finestra 5 ore.                                                   |
| GET    | `/usage/weekly`  | Solo la finestra settimanale.                                            |
| POST   | `/ping`          | Invia un ping a Haiku per avviare la finestra 5h, poi rilegge l'usage.   |

Ogni finestra è normalizzata come `{ utilization, resets_at, resets_in_seconds }`.

Esempi:

```bash
curl http://localhost:4317/usage
curl http://localhost:4317/usage/5h
curl -X POST http://localhost:4317/ping
```

## Note

- L'endpoint usage di Anthropic (`/api/oauth/usage`) **non è documentato pubblicamente**:
  potrebbe cambiare con gli aggiornamenti della CLI. È isolato in `src/anthropic.ts`,
  facile da aggiornare.
- L'auto-refresh riscrive `.credentials.json` in modo atomico, preservando gli altri campi.
  Se preferisci gestire il rinnovo solo tramite la CLI, imposta `DISABLE_REFRESH=1`.
