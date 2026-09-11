// _auth.js — shared helpers for Pages Functions: hashing, settings
// read/write against D1, JSON responses, and bearer-token auth.
//
// The "token" used as a Bearer credential is sha256(password). It's
// stateless (no session table) and never leaves the server as a raw
// password after login — good enough for this internal convenience lock,
// not meant to be bank-grade auth.

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setSetting(db, key, value) {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

// The GitHub token used by /api/github: a D1-stored token (settable from
// Settings, no CLI needed) takes priority; env.GITHUB_TOKEN (a Wrangler
// secret) is the fallback for anyone who prefers to set it that way.
export async function getGithubToken(env) {
  const stored = await getSetting(env.DB, 'githubToken');
  return stored || env.GITHUB_TOKEN || null;
}

// Returns the verified token string, or null if missing/invalid/no password set yet.
export async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const hash = await getSetting(env.DB, 'passwordHash');
  if (!hash) return null;
  return token === hash ? token : null;
}
