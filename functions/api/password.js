// PUT /api/password  { newPassword }  (requires Authorization: Bearer <current token>)

import { sha256Hex, requireAuth, setSetting, json } from '../_auth.js';

export async function onRequestPut({ request, env }) {
  const token = await requireAuth(request, env);
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const newPassword = body?.newPassword;
  if (!newPassword || typeof newPassword !== 'string') {
    return json({ error: 'New password required' }, { status: 400 });
  }

  const newToken = await sha256Hex(newPassword);
  await setSetting(env.DB, 'passwordHash', newToken);
  return json({ ok: true, token: newToken });
}
