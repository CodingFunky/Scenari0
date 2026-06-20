# Scenari0 sync proxy

A tiny Cloudflare Worker that lets the static app reach external APIs without
exposing keys in the browser. It routes two providers:

- `/competitions/*` → [football-data.org](https://www.football-data.org/) (results), auth `X-Auth-Token`, secret `FOOTBALL_DATA_KEY`
- `/odds/*` → [The Odds API](https://the-odds-api.com/) (betting odds), auth `apiKey` query param, secret `ODDS_API_KEY`

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
wrangler secret put FOOTBALL_DATA_KEY   # paste your football-data.org key
wrangler secret put ODDS_API_KEY         # paste your The Odds API key
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

## Rate limiting

The Worker enforces a **per-IP rate limit** via Cloudflare's Rate Limiting
binding (configured in [`wrangler.toml`](wrangler.toml)) — currently
**6 requests/minute per IP per route**. Over-limit requests get a `429` *before*
any upstream call, so they never spend your API quota. The app handles `429`
gracefully (falls back to cached results / shows a "wait a minute" message).

- Tune the cap by editing `simple = { limit = 6, period = 60 }` in `wrangler.toml`
  (`period` must be `10` or `60`), then `wrangler deploy`.
- This caps a single visitor. It does **not** enforce a global monthly budget
  (e.g. The Odds API's 500/mo across all users) — that needs a KV-counter
  approach, which can be added later.
- If `wrangler deploy` rejects the binding on your plan, the fallback is a
  Cloudflare dashboard **Rate Limiting rule** (Security → WAF) targeting the
  Worker route; remove the `[[ratelimits]]` block in that case.

## Notes

- The app requests `/competitions/WC/matches?status=FINISHED`. World Cup's code
  is `WC`; override it at runtime via `localStorage.sync_competition` if needed.
- football-data.org's **free tier has limited competition coverage and a
  10 req/min rate limit**. If `/competitions/WC/matches` returns `403` or an
  empty list, that's a plan-scope issue, not an app bug — the app falls back to
  its last cached results and won't crash.
- For production, set `ALLOW_ORIGIN` in `worker.js` to your GitHub Pages origin
  instead of `*`.
- **Odds:** the app requests `/odds/sports/soccer_fifa_world_cup/odds?regions=eu&markets=h2h`.
  The Odds API free tier is 500 req/month and only lists active/upcoming events,
  so 2026 WC odds may be empty — the simulation falls back to a FIFA-rankings-only
  blend when no odds are returned. Test directly with:
  `curl "https://worldcup-proxy.<sub>.workers.dev/odds/sports/soccer_fifa_world_cup/odds?regions=eu&markets=h2h"`
```
