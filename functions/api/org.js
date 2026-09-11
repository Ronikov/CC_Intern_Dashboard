// GET /api/org  -> { githubOrg }
// PUT /api/org  <- { githubOrg }
// Remembers which GitHub org/username "Sync from GitHub" (on the Projects
// tab) scans for repos. Requires Authorization: Bearer <token>.

import { requireAuth, getSetting, setSetting, json } from '../_auth.js';

export async function onRequestGet({ request, env }) {
  const token = await requireAuth(request, env);
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });
  const githubOrg = (await getSetting(env.DB, 'githubOrg')) || '';
  return json({ githubOrg });
}

export async function onRequestPut({ request, env }) {
  const token = await requireAuth(request, env);
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const githubOrg = (body?.githubOrg || '').trim();
  await setSetting(env.DB, 'githubOrg', githubOrg);
  return json({ ok: true, githubOrg });
}
