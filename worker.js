// Sillage : liste d'attente du site vitrine (Cloudflare Worker + base D1 liée sous le nom « DB »).
// Indépendant de l'application : aucune donnée de l'app ici, aucune donnée d'ici dans l'app.
const ALLOWED_ORIGINS = ['https://hellosillage.app', 'https://www.hellosillage.app'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GMAIL_RE = /^[^\s@]+@(gmail|googlemail)\.com$/i;
const PER_IP = 5; // inscriptions par heure et par adresse IP
const GLOBAL_MAX = 300; // inscriptions par heure au total
const HOUR = 3600;

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const h = { Vary: 'Origin' };
  if (ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function reply(request, status, body) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), ...(body === null ? {} : { 'Content-Type': 'application/json' }) },
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method !== 'POST') return reply(request, 405, { ok: false });

    let body;
    try {
      body = await request.json();
    } catch {
      return reply(request, 400, { ok: false });
    }
    if (!body || typeof body !== 'object') return reply(request, 400, { ok: false });
    if (typeof body.website === 'string' && body.website) return reply(request, 200, { ok: true }); // champ piège : un robot l'a rempli

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email.length > 254 || !EMAIL_RE.test(email)) return reply(request, 422, { ok: false });
    const lang = body.lang === 'fr' || body.lang === 'en' ? body.lang : null;
    const platform = body.platform === 'android' || body.platform === 'ios' ? body.platform : null;
    let gmail = typeof body.gmail === 'string' ? body.gmail.trim() : '';
    if (gmail && (gmail.length > 254 || !GMAIL_RE.test(gmail))) return reply(request, 422, { ok: false });
    gmail = gmail || null;

    try {
      const now = Math.floor(Date.now() / 1000);
      const ip = request.headers.get('CF-Connecting-IP') || 'inconnue';
      const ipHash = await sha256('sillage-waitlist:' + ip);
      await env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(now - HOUR).run();
      const mine = await env.DB.prepare('SELECT count(*) AS n FROM hits WHERE ip_hash = ?').bind(ipHash).first();
      const all = await env.DB.prepare('SELECT count(*) AS n FROM hits').first();
      if ((mine?.n ?? 0) >= PER_IP || (all?.n ?? 0) >= GLOBAL_MAX) return reply(request, 429, { ok: false });
      await env.DB.batch([
        env.DB.prepare('INSERT INTO hits (ip_hash, ts) VALUES (?, ?)').bind(ipHash, now),
        // même réponse que l'adresse soit nouvelle ou déjà inscrite : on ne révèle pas qui est dans la liste
        // si l'adresse est déjà inscrite, on complète ses informations (plateforme, Gmail) sans rien révéler
        env.DB.prepare('UPDATE waitlist SET platform = COALESCE(?, platform), gmail = COALESCE(?, gmail) WHERE lower(email) = lower(?)').bind(platform, gmail, email),
        env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, lang, platform, gmail) VALUES (?, ?, ?, ?)').bind(email, lang, platform, gmail),
      ]);
    } catch (e) {
      console.log('waitlist: échec d\'enregistrement', String(e));
      return reply(request, 503, { ok: false });
    }
    return reply(request, 200, { ok: true });
  },
};
