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
| `CLAUDIOMETRO_DATA_DIR` | `./data` | Cartella dove vengono persistiti i ping programmati.                       |
| `CLAUDIOMETRO_ADMIN_TOKEN` | _(vuoto)_ | Segreto per gli endpoint `/admin/*`. Vuoto = endpoint admin disabilitati (fail-closed). |

Lato frontend (`frontend/config.js`):

| Variabile                       | Default      | Descrizione                                              |
|---------------------------------|--------------|----------------------------------------------------------|
| `CLAUDIOMETRO_API_BASE`         | `""`         | Base URL delle API. Vuoto = stesso host che serve la pagina. Per puntare a un altro host in LAN: `"http://192.168.1.50:4317"`. |
| `CLAUDIOMETRO_POLL_SECONDS`     | `30`         | Intervallo di auto-refresh dei gauge. `0` = disabilita.  |

## Endpoint API

| Metodo | Path                    | Risposta                                                                       |
|--------|-------------------------|--------------------------------------------------------------------------------|
| GET    | `/health`               | `{ "ok": true }`                                                               |
| GET    | `/usage`                | Tutte le finestre normalizzate + `extra_usage` + `fetched_at`.                 |
| GET    | `/usage/5h`             | Solo la finestra 5 ore.                                                        |
| GET    | `/usage/weekly`         | Solo la finestra settimanale.                                                  |
| POST   | `/ping`                 | Invia un ping a Haiku **subito** (default) oppure lo **schedula** nel futuro.  |
| GET    | `/ping/scheduled`       | Elenco dei ping programmati (pending + esiti recenti).                         |
| DELETE | `/ping/scheduled/:id`   | Annulla un ping ancora in attesa.                                              |
| POST   | `/admin/credentials`    | **(admin)** Carica/aggiorna le credenziali OAuth da remoto.                    |
| GET    | `/admin/credentials/status` | **(admin)** Stato delle credenziali (presenza, scadenza) senza i token.    |

Ogni finestra è normalizzata come `{ utilization, resets_at, resets_in_seconds }`.

### Schedulare un ping

`POST /ping` accetta un body JSON opzionale:

- **`{ }`** o body assente → ping immediato (comportamento di default).
- **`{ "at": "2026-05-31T14:30:00Z" }`** → schedula il ping a quell'istante (ISO 8601).
- **`{ "delay_seconds": 3600 }`** → schedula tra N secondi.

Limite: **massimo 3 giorni nel futuro** (oltre → `400`). Orari nel passato vengono trattati
come immediati. I ping programmati sono **persistiti su disco** (`data/scheduled-pings.json`)
e ricaricati all'avvio: se il server era spento all'orario previsto, il ping parte appena
riavviato. Un ping schedulato risponde `202 { scheduled: true, id, run_at }`.

Esempi:

```bash
curl http://localhost:4317/usage
curl http://localhost:4317/usage/5h

# Ping immediato
curl -X POST http://localhost:4317/ping

# Ping tra un'ora
curl -X POST http://localhost:4317/ping \
  -H "Content-Type: application/json" \
  -d '{"delay_seconds": 3600}'

# Ping a data/ora precisa
curl -X POST http://localhost:4317/ping \
  -H "Content-Type: application/json" \
  -d '{"at": "2026-05-31T14:30:00Z"}'

# Lista e annullamento
curl http://localhost:4317/ping/scheduled
curl -X DELETE http://localhost:4317/ping/scheduled/<id>
```

Lato webapp: il campo **"quando"** accanto al pulsante è vuoto di default (= invia subito);
selezionando una data/ora futura il ping viene programmato e compare nella card
**"Ping programmati"**, da cui puoi annullarlo.

## Deploy su TrueNAS (Docker)

L'idea: far girare claudiometro in un container **sempre acceso** sul NAS, così che
usage e scheduling dei ping funzionino anche a PC spento. Il container non ha
"nativamente" le credenziali OAuth del tuo PC: gliele si fornisce con un **volume**
persistente e/o caricandole **da remoto** via API.

> ⚠️ **Sicurezza (leggere prima):** questo setup è pensato per una **LAN domestica
> fidata in HTTP**. I token viaggiano **in chiaro** sulla rete locale. Di conseguenza:
> - imposta **sempre** `CLAUDIOMETRO_ADMIN_TOKEN` (senza, gli endpoint `/admin/*` sono
>   disabilitati → `503`);
> - **non esporre mai** il server su internet pubblico (niente port-forward sul router).
>   Per accesso da fuori usa una VPN o un reverse proxy con TLS + auth.

### 1. Build e avvio del container

Sul NAS, in una cartella dedicata, metti il repo (o il solo `docker-compose.yml`) e crea
un `.env` con il segreto admin:

```bash
# .env accanto al docker-compose.yml
CLAUDIOMETRO_ADMIN_TOKEN=<un-segreto-lungo-e-casuale>
```

Poi:

```bash
docker compose up -d --build
```

Vengono creati due volumi (bind-mount):

| Host (NAS)   | Container  | Contenuto                                  |
|--------------|------------|--------------------------------------------|
| `./config`   | `/config`  | `.credentials.json` (le credenziali OAuth) |
| `./data`     | `/data`    | `scheduled-pings.json` (ping programmati)  |

### 2. Caricare le credenziali dal PC

Dopo aver fatto login con la CLI di Claude Code sul PC, lancia dal PC:

```bash
node scripts/push-credentials.mjs http://NAS:4317 <CLAUDIOMETRO_ADMIN_TOKEN>
```

Lo script legge `~/.claude/.credentials.json` (o `CLAUDE_CONFIG_DIR`) e fa
`POST /admin/credentials` con header `Authorization: Bearer <token>`. Non stampa mai
i token, solo l'esito (`expiresAt`, `scopes`). In alternativa puoi copiare a mano il
file in `./config/.credentials.json` sul NAS.

Verifica lo stato:

```bash
curl -H "Authorization: Bearer <token>" http://NAS:4317/admin/credentials/status
# -> { "present": true, "expiresAt": ..., "expired": false, "scopes": [...] }
```

Quando le credenziali smettono di funzionare (refresh scaduto/ruotato), basta ri-lanciare
`push-credentials.mjs` dal PC.

### 3. Caveat: rotazione del refresh token

Ad ogni refresh, Anthropic **può** restituire un nuovo `refresh_token` (single-use). Se il
**NAS** e la **CLI del PC** fanno refresh in parallelo partendo dallo stesso token, uno dei
due può invalidarsi. Consigli:

- lascia che il **NAS** (acceso H24) sia l'istanza che gestisce il refresh;
- se le credenziali del PC smettono di funzionare, rifai login con la CLI e ri-pusha;
- in alternativa imposta `DISABLE_REFRESH=1` su uno dei due lati per evitare il conflitto.

## Note

- L'endpoint usage di Anthropic (`/api/oauth/usage`) **non è documentato pubblicamente**:
  potrebbe cambiare con gli aggiornamenti della CLI. È isolato in `src/anthropic.ts`,
  facile da aggiornare.
- L'auto-refresh riscrive `.credentials.json` in modo atomico, preservando gli altri campi.
  Se preferisci gestire il rinnovo solo tramite la CLI, imposta `DISABLE_REFRESH=1`.
