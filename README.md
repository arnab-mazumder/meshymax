<div align="center">

# Meshy Auto-Converter

**A full-stack web application that wraps the real Meshy AI workspace with automatic `.meshy → .glb` conversion.**

Playwright drives a persistent Chromium session. When Meshy generates a model, the response is intercepted, decrypted, decompressed, and saved as a standard `.glb` — automatically, without any extra steps from the user.

[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-1.44+-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![License](https://img.shields.io/badge/License-MIT-6366f1)](./LICENSE)

</div>

---

## What this is

Meshy serves its exported 3D models as `.meshy` files — an AES-256-CTR encrypted, meshopt-compressed GLB container. This project adds a transparent conversion layer around the actual Meshy web workspace:

```
User uses Meshy normally
        ↓
Meshy requests model.meshy from assets.meshy.ai
        ↓
Playwright intercepts the response body
        ↓
Local AES-256-CTR decrypt  (WebCrypto)
        ↓
meshopt decompression  (WASM)
        ↓
Standard .glb  →  automatic download
```

The user does not need to change their Meshy workflow. Authentication is performed manually in the browser window. Everything after login is handled automatically.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     WEB DASHBOARD                            │
│                    http://localhost:3000                      │
│                                                              │
│  ┌────────────────────────────────┐  ┌────────────────────┐  │
│  │   MESHY WORKSPACE              │  │  CONVERTER PANEL   │  │
│  │   Live screencast of the       │  │                    │  │
│  │   Playwright browser session   │  │  ● Monitoring      │  │
│  │                                │  │  ⟳ task_abc123     │  │
│  │   Click / scroll / type to     │  │  ████████ 60%      │  │
│  │   interact remotely            │  │                    │  │
│  │                                │  │  ✓ abc123.glb      │  │
│  │                                │  │  ✓ 7af812.glb      │  │
│  └────────────────────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                          │ WebSocket
┌──────────────────────────────────────────────────────────────┐
│                     NODE.JS BACKEND                          │
│                                                              │
│  backend/server.js         Express HTTP + WebSocket server   │
│  backend/browser.js        Playwright Chromium controller    │
│  backend/network-monitor.js  Response interceptor           │
│  backend/converter-service.js  Task queue & history         │
└──────────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────────┐
│                   LOCAL CONVERTER ENGINE                     │
│                                                              │
│  src/converter.js          convertMeshy(buffer) API          │
│  src/decrypt.js            AES-256-CTR decrypt (WebCrypto)   │
│  src/decompress.js         meshopt → standard GLB            │
│  src/meshopt_decoder.module.js  Vendored WASM decoder        │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js 18+** (tested on v22)
- A **Meshy AI account** — free or paid

### Install

```bash
git clone https://github.com/Amal-David/meshy2glb
cd meshy2glb
npm install
npx playwright install chromium
```

### Run

```bash
npm start
```

Open **http://localhost:3000**

---

## User Flow

```
1.  Open http://localhost:3000

2.  Click  [ Launch Meshy ]

3.  A Chromium window opens, navigating to:
    https://www.meshy.ai/workspace#genMode-img3d

4.  Log in to your existing Meshy account.
    (Authentication is entirely manual — no credentials are stored.)

5.  The dashboard shows the browser session as a live screencast.
    You can click, scroll, and type directly from the dashboard.

6.  Use Meshy normally — upload images, configure generation, generate models.

7.  When Meshy generates a model, it fetches:
    https://assets.meshy.ai/.../tasks/<taskId>/output/model.meshy?...

8.  The network monitor detects the response.

9.  The binary body is captured via response.body() — no second request.

10. convertMeshy() runs:
      AES-256-CTR decrypt  →  meshopt decompress  →  GLB

11. <taskId>.glb downloads automatically in your browser.

12. The dashboard shows the task as completed in Recent Conversions.
```

---

## Features

### Core

| Feature | Description |
|---------|-------------|
| **Real Meshy workspace** | Actual Meshy website runs in a Playwright-controlled Chromium session — no mock UI |
| **Persistent session** | Login state is preserved across restarts in `.meshy-session/` |
| **Live screencast** | JPEG frames streamed over WebSocket at ~5 fps |
| **Remote interaction** | Click, scroll, and keypress events forwarded from dashboard to browser |
| **Automatic conversion** | Triggered by network interception — no manual download needed |
| **Auto-download** | `.glb` file downloads automatically to your browser when ready |
| **Duplicate prevention** | In-memory `Set` prevents the same task ID from converting twice |

### Manual Tools

| Tool | Description |
|------|-------------|
| **Drag & Drop upload** | Drop any `.meshy` or `.glb` file for local conversion |
| **URL converter** | Paste a Meshy asset URL; the authenticated Playwright session fetches and converts it |

### Dashboard

| Panel | Description |
|-------|-------------|
| **Status header** | Real-time browser state: `Browser starting` → `Waiting for login` → `Ready` → `Monitoring` |
| **Auto Convert toggle** | Enable/disable automatic conversion (persisted in `localStorage`) |
| **Active conversion** | Progress bar, current task ID, current step |
| **Conversion history** | Task ID, timestamp, file size, status — with Download and Delete buttons |
| **Network monitor log** | Safe metadata only: method, URL path (tokens stripped), HTTP status, match highlight |
| **Toast notifications** | Success, failure, and detection alerts |

---

## Browser States

| State | Meaning |
|-------|---------|
| `Disconnected` | Playwright browser not running |
| `Browser starting` | Chromium launching |
| `Waiting for login` | Browser reached Meshy login page — user must authenticate |
| `Meshy loading` | Navigating to workspace URL |
| `Ready` | Workspace loaded; monitoring is active |
| `Error` | Browser or navigation failure |

---

## Automatic Conversion Pipeline

```
network-monitor.js
  │
  │  response.url() matches:
  │  ^https://assets\.meshy\.ai/.+/tasks/.+/output/model\.meshy
  │
  ↓
Extract taskId from URL
  /tasks/([^/]+)/output/model.meshy
  │
  ↓
Duplicate check (processedTasks Set)
  │
  ↓
response.body()  — original response body, no re-request
  │
  ↓
converter-service.js
  │
  ├── Status: Downloading  (30%)
  ├── Status: Converting   (60%)
  └── Status: Completed   (100%)
      │
      ↓
   src/converter.js
      │
      ├── isMeshyFile() — validate MESHY.AI magic
      ├── meshyToGlb()  — AES-256-CTR decrypt (WebCrypto)
      └── decompressGlb() — EXT_meshopt_compression → raw vertices
          │
          ↓
       <taskId>.glb  →  automatic browser download
```

---

## WebSocket Events

All state is pushed over WebSocket — the frontend never polls.

| Event | Direction | Payload |
|-------|-----------|---------|
| `init_state` | server → client | Full initial state on connect |
| `meshy_status` | server → client | `{ status }` |
| `screencast_frame` | server → client | `{ frame }` — base64 JPEG |
| `model_detected` | server → client | `{ taskId, sizeBytes, timestamp }` |
| `conversion_started` | server → client | `{ task }` |
| `conversion_progress` | server → client | `{ task }` |
| `conversion_completed` | server → client | `{ task, filename }` |
| `conversion_failed` | server → client | `{ taskId, error, task }` |
| `network_log` | server → client | `{ log }` — safe metadata |
| `launch_browser` | client → server | — |
| `reconnect_browser` | client → server | — |
| `close_browser` | client → server | — |
| `set_autoconvert` | client → server | `{ enabled }` |
| `browser_interact` | client → server | `{ interaction }` — click/scroll/key |

---

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/browser/launch` | Launch Playwright Chromium |
| `POST` | `/api/browser/reconnect` | Navigate back to Meshy workspace |
| `POST` | `/api/browser/close` | Close the browser session |
| `POST` | `/api/browser/interact` | Forward an interaction event |
| `GET` | `/api/browser/status` | Current browser status |
| `POST` | `/api/convert/file` | Upload a `.meshy` file for conversion |
| `POST` | `/api/convert/url` | Fetch and convert a Meshy asset URL |
| `GET` | `/api/download/:taskId` | Download a converted `.glb` |
| `GET` | `/api/history` | List conversion history |
| `POST` | `/api/history/clear` | Clear all history |
| `DELETE` | `/api/history/:taskId` | Remove a single history entry |
| `POST` | `/api/toggle-autoconvert` | Toggle automatic conversion |

---

## Security

- **No credentials stored** — authentication is manual; no Meshy username, password, or tokens are ever stored by this application
- **Tokens stripped from logs** — the network monitor log strips query parameters (which contain signed asset tokens) before broadcasting to the frontend
- **No CDP exposure** — the Playwright CDP endpoint is not published
- **SSRF protection** — the URL converter endpoint validates against a strict regex before making any outbound request; arbitrary URLs are rejected
- **Isolated Playwright context** — uses a persistent context directory isolated to `.meshy-session/`
- **Temp file cleanup** — converted files are stored in memory; temp directories under `/tmp/meshy-auto-converter/` are deleted after each conversion

---

## `.meshy` File Format

Reverse-engineered clean-room implementation — no Meshy source code or WASM is used.

```
Offset          Contents
──────────────  ──────────────────────────────────────────────────
0..7            Magic: "MESHY.AI"
8..9            Version: uint16 LE (observed: 1)
10..21          12-byte AES nonce
22..31          Reserved
32..8223        AES-256-CTR ciphertext  (8192 bytes)
8224..8239      16-byte AES-GCM auth tag  (skipped)
8240..EOF       Plaintext: WebP textures + meshopt-compressed vertex/index streams
```

**Cipher:** AES-256-CTR, key = `JSON{"accessors":[{"bufferView":` (literal ASCII), counter = `nonce || uint32be(2)`

Decrypting the first 8 KB and splicing the plaintext tail back produces a standard GLB using `EXT_meshopt_compression`. `decompressGlb()` then expands every compressed bufferView to raw vertex/index data, producing a plain GLB that any glTF viewer can open.

Full reverse-engineering notes are in [NOTES.md](./NOTES.md).

---

## Tests

```bash
npm test
```

```
✔ converter - recognizes invalid file format
✔ converter - passes through standard GLB buffer
✔ isMeshyFile recognises the MESHY.AI magic
✔ isGlbFile recognises the glTF magic
✔ meshyToGlb rejects garbage input
✔ meshyToGlb passes through a GLB unchanged
✔ network monitor - matches valid meshy model URLs
✔ network monitor - rejects non-matching URLs
✔ network monitor - extracts task ID correctly
```

To run fixture-driven tests against real `.meshy` files, place them in `tests/fixtures/` or set `$MESHY_FIXTURES`.

---

## Project Structure

```
meshy2glb/
│
├── frontend/
│   ├── index.html              Dashboard UI
│   ├── app.js                  WebSocket client, interaction forwarding, toasts
│   └── styles.css              Dark glassmorphism design system
│
├── backend/
│   ├── server.js               Express + WebSocket server (port 3000)
│   ├── browser.js              Playwright Chromium session + screencast
│   ├── network-monitor.js      Response interceptor, URL matching, dupe prevention
│   └── converter-service.js    Task queue, history, temp file management
│
├── src/
│   ├── converter.js            convertMeshy() — public API
│   ├── decrypt.js              AES-256-CTR decryption via WebCrypto
│   ├── decompress.js           EXT_meshopt_compression → standard GLB
│   └── meshopt_decoder.module.js  Vendored WASM meshopt decoder (MIT)
│
├── tests/
│   ├── decrypt.test.mjs        Crypto unit tests
│   ├── converter.test.mjs      Converter API unit tests
│   ├── network.test.mjs        URL matching + task ID extraction tests
│   └── meshopt_decoder.module.js  Decoder for offline test use
│
├── .meshy-session/             Playwright persistent context (gitignored)
├── package.json
├── NOTES.md                    Reverse-engineering notes
└── README.md
```

---

## Credits

- [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) — mesh compression library (MIT)
- [microsoft/playwright](https://github.com/microsoft/playwright) — browser automation (Apache-2.0)
- [youssef02/meshy2glb](https://github.com/youssef02/meshy2glb) — original Tampermonkey approach
- [Pouare514/meshy-downloader](https://github.com/Pouare514/meshy-downloader) — Chrome extension with similar in-page intercept

---

## Disclaimer

Not affiliated with [meshy.ai](https://meshy.ai). This project does not bypass authentication, rate limits, or access controls. It operates on an authenticated session that the user establishes manually.

---

## License

[MIT](./LICENSE)
