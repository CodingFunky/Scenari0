# Scenari0 sync proxy

A tiny Cloudflare Worker that lets the static app pull live World Cup results
from [API-Football](https://www.api-football.com/) without exposing your API key
in the browser.

## Why a proxy?

The app is a static site (no server). If the API key were in the client JS it
would be visible to anyone — and public in your GitHub repo. api-sports.io also
blocks direct browser calls (CORS). This Worker:

- holds the key in a server-side **secret** (`API_FOOTBALL_KEY`),
- injects it as the `x-apisports-key` header on each upstream request,
- adds CORS headers so the browser app can call it,
- restricts usage to the `/fixtures` and `/status` paths.

## Deploy

### Option A — CLI (wrangler)

```bash
npm i -g wrangler
wrangler login
cd proxy
wrangler secret put API_FOOTBALL_KEY   # paste your key when prompted
wrangler deploy
```

You'll get a URL like `https://worldcup-proxy.<your-subdomain>.workers.dev`.

### Option B — Cloudflare dashboard (no install)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Replace the starter code with the contents of [`worker.js`](worker.js). Deploy.
3. Open the Worker → **Settings** → **Variables and Secrets** → add an
   **encrypted** variable named `API_FOOTBALL_KEY` with your key. Save & deploy.

## Wire it into the app

Open the app, click the **⚙** next to *Sync Results*, and paste your Worker URL.
It's stored in your browser's `localStorage` only.

## Test the proxy directly

```bash
curl "https://worldcup-proxy.<your-subdomain>.workers.dev/status"
```

A JSON response with your account/subscription info means the key and CORS are
wired correctly.

## Notes

- World Cup is league `1`, season `2026` in API-Football. The app requests
  `/fixtures?league=1&season=2026`.
- For production, set `ALLOW_ORIGIN` in `worker.js` to your GitHub Pages origin
  instead of `*`.
