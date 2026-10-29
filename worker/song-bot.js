/*
 * Cassette.fm Cassette AI song finder: a tiny Cloudflare Worker (free plan is plenty).
 *
 * The app sends what the listener typed or said ("that rain song from Mohra", "Tip Tip Barsa Paani",
 * "Arijit's song from Animal"). This worker asks Claude which songs they mean and sends back the
 * song names, films, singers and year. When a YouTube key is set it also finds each song's official
 * video, which the app plays inside YouTube's own player.
 *
 * Why a worker: the AI key must never be inside the website or APK, or anyone could copy it.
 * Setup: see SONG-BOT.md. Secrets: ANTHROPIC_API_KEY (required), YOUTUBE_API_KEY (optional).
 * Variables: AI_MODEL (default claude-haiku-5-5), ALLOWED_ORIGINS (comma list; default allows the app).
 */

const DEFAULT_MODEL = 'claude-haiku-5-5';
/** Per visitor per minute, a simple guard against someone burning your credit. */
const PER_MINUTE = 8;
const hits = new Map(); // ip → [timestamps] (per worker instance; good enough as a soft limit)

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    // The Android app's WebView: https://localhost (Capacitor) or capacitor://localhost.
    const ok = !allowed.length || allowed.includes(origin) || /^(https?|capacitor):\/\/localhost(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin || '*' : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST' || !ok) return json({ error: 'not_allowed' }, 403, cors);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
    if (recent.length >= PER_MINUTE) return json({ error: 'slow_down' }, 429, cors);
    recent.push(now);
    hits.set(ip, recent);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, cors); }
    const message = String(body.message || '').slice(0, 500).trim();
    const language = String(body.language || 'Hindi').slice(0, 40);
    const industry = String(body.industry || 'Bollywood').slice(0, 40);
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    if (!message) return json({ error: 'empty' }, 400, cors);

    const answer = await askClaude(env, message, language, industry, history);
    if (!answer) return json({ error: 'ai_unavailable' }, 502, cors);

    if (env.YOUTUBE_API_KEY) {
      await Promise.all(answer.songs.slice(0, 3).map(async song => {
        song.youtubeId = await findVideo(env.YOUTUBE_API_KEY, song).catch(() => null);
      }));
    }
    return json(answer, 200, cors);
  },
};

async function askClaude(env, message, language, industry, history) {
  const rules = [
    'You are Cassette AI, the song finder inside Cassette.fm, a free Indian music app.',
    `The listener's chosen music language is ${language} (${industry}), but they may ask for any language.`,
    'Work out which real, released song(s) they mean from whatever they give: a title (even misspelt or in Hinglish),',
    'a film, actors, a singer, a scene, a mood, a year, or a few words they remember.',
    'Give up to 5 candidates, most likely first. Only list songs you are confident really exist.',
    'Never write out song lyrics; refer to songs only by their titles.',
    'Reply with only JSON in this shape:',
    '{"reply": "one or two friendly sentences, in the language the listener used", "songs": [{"title": "", "film": "", "artists": "", "year": 0, "language": ""}]}',
    'If you cannot tell which song they mean, return an empty "songs" list and ask one short question in "reply".',
  ].join('\n');

  const turns = history
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && t.content)
    .map(t => ({ role: t.role, content: String(t.content).slice(0, 800) }));
  const messages = [...turns, { role: 'user', content: message }];
  if (messages[0].role !== 'user') messages.shift();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL || DEFAULT_MODEL, max_tokens: 700, system: rules, messages }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const songs = (Array.isArray(parsed.songs) ? parsed.songs : []).slice(0, 5).map(s => ({
      title: String(s.title || '').slice(0, 120), film: String(s.film || '').slice(0, 120),
      artists: String(s.artists || '').slice(0, 160), year: Number(s.year) || null, language: String(s.language || '').slice(0, 40),
    })).filter(s => s.title);
    return { reply: String(parsed.reply || '').slice(0, 600), songs };
  } catch {
    return { reply: text.slice(0, 600), songs: [] };
  }
}

/** The most-viewed embeddable video for the song (usually the label's official upload). */
async function findVideo(key, song) {
  const q = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '1', videoEmbeddable: 'true', order: 'relevance',
    q: `${song.title} ${song.film} ${song.artists} song`.trim(), key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${q}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0]?.id?.videoId || null;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
