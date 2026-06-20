// Cloudflare Worker — API-Football proxy for Scenari0.
//
// Why this exists: the app is a static client-side site, so it has no server
// and no env vars. Putting the API key in browser JS would expose it publicly,
// and api-sports.io blocks direct browser calls (CORS). This Worker holds the
// key in a real server-side secret, injects it as the request header, and adds
// CORS headers so the browser app can call it.
//
// Deploy (CLI):
//   npm i -g wrangler
//   wrangler login
//   wrangler secret put API_FOOTBALL_KEY   # paste your key when prompted
//   wrangler deploy
// Then paste the resulting https://<name>.<subdomain>.workers.dev URL into the
// app's  ⚙ Sync settings  field.
//
// (Dashboard alternative: Cloudflare dashboard → Workers → Create → paste this
//  file → Settings → Variables → add encrypted var API_FOOTBALL_KEY.)

const UPSTREAM = 'https://v3.football.api-sports.io';

// Only let the key be used for these paths, so a leaked proxy URL can't be
// abused to drain your API quota on arbitrary endpoints.
const ALLOWED_PATHS = ['/fixtures', '/status'];

// Tighten this to your GitHub Pages origin in production,
// e.g. 'https://yourname.github.io'.
const ALLOW_ORIGIN = '*';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    const allowed = ALLOWED_PATHS.some(
      p => url.pathname === p || url.pathname.startsWith(p + '/')
    );
    if (!allowed) return json({ error: 'Path not allowed' }, 403);

    if (!env.API_FOOTBALL_KEY) {
      return json({ error: 'Proxy is missing the API_FOOTBALL_KEY secret' }, 500);
    }

    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        headers: {
          // Direct api-sports.io uses this header. If you switch to the RapidAPI
          // gateway, change UPSTREAM and use 'X-RapidAPI-Key' instead.
          'x-apisports-key': env.API_FOOTBALL_KEY,
          'Accept': 'application/json',
        },
      });
    } catch (err) {
      return json({ error: 'Upstream fetch failed: ' + err.message }, 502);
    }

    const body = await upstreamRes.text();
    return new Response(body, {
      status: upstreamRes.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
