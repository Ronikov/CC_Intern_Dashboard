// GET /api/github-token  -> { isSet, hint }   (never returns the raw token)
// PUT /api/github-token  <- { token }
// Requires Authorization: Bearer <token> from /api/login.

import { requireAuth, getSetting, setSetting, json } from '../_auth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: 'Unauthorized' }, { status: 401 });

  const token = await getSetting(env.DB, 'githubToken');
  if (!token) return json({ isSet: false, hint: '' });
  return json({ isSet: true, hint: `…${token.slice(-4)}` });
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const token = (body?.token || '').trim();
  if (!token) return json({ error: 'Token required' }, { status: 400 });

  await setSetting(env.DB, 'githubToken', token);
  return json({ ok: true, hint: `…${token.slice(-4)}` });
}
