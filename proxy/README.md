# Scenari0 sync proxy

A tiny Cloudflare Worker that lets the static app pull live World Cup results
from [football-data.org](https://www.football-data.org/) without exposing your
API key in the browser.

## Why a proxy?

The app is a static site (no server). If the API key were in the client JS it
would be visible to anyone — and public in your GitHub repo. football-data.org
also doesn't send permissive CORS headers for browser use. This Worker:

- holds the key in a server-side **secret** (`FOOTBALL_DATA_KEY`),
- injects it as the `X-Auth-Token` header on each upstream request,
- adds CORS headers so the browser app can call it,
- restricts usage to the `/competitions` paths.

## Deploy

### Option A — CLI (wrangler)

```bash
npm i -g wrangler
wrangler login
cd proxy
wrangler secret put FOOTBALL_DATA_KEY   # paste your key when prompted
wrangler deploy
```

You'll get a URL like `https://worldcup-proxy.<your-subdomain>.workers.dev`.

> Changing the Worker code (e.g. this migration) requires `wrangler deploy`.
> Setting/replacing the secret with `wrangler secret put` applies immediately
> and does **not** need a redeploy — but you need both done for it to work.

### Option B — Cloudflare dashboard (no install)

1. Cloudflare dashboard → **Workers & Pages** → open your Worker.
2. Replace the code with the contents of [`worker.js`](worker.js). Deploy.
3. **Settings** → **Variables and Secrets** → add/replace an **encrypted**
   variable named `FOOTBALL_DATA_KEY` with your key. Save & deploy.

## Wire it into the app

Open the app, click the **⚙** next to *Sync Results*, and paste your Worker URL.
It's stored in your browser's `localStorage` only.

## Test the proxy directly

```bash
curl "https://worldcup-proxy.<your-subdomain>.workers.dev/competitions/WC"
```

A JSON blob describing the World Cup competition means the key and CORS are
wired correctly. A `{"error":"Proxy is missing the FOOTBALL_DATA_KEY secret"}`
means the secret isn't set; `403`/restricted means your plan doesn't include
that competition.

## Notes

- The app requests `/competitions/WC/matches?status=FINISHED`. World Cup's code
  is `WC`; override it at runtime via `localStorage.sync_competition` if needed.
- football-data.org's **free tier has limited competition coverage and a
  10 req/min rate limit**. If `/competitions/WC/matches` returns `403` or an
  empty list, that's a plan-scope issue, not an app bug — the app falls back to
  its last cached results and won't crash.
- For production, set `ALLOW_ORIGIN` in `worker.js` to your GitHub Pages origin
  instead of `*`.
```
