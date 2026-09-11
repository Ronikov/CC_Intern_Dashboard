// POST /api/login  { password }
// First ever call sets the shared password; every call after that just
// checks it. Returns a bearer token (sha256 of the password) the client
// attaches to every other request.

import { sha256Hex, getSetting, setSetting, json } from '../_auth.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const password = body?.password;
  if (!password || typeof password !== 'string') {
    return json({ error: 'Password required' }, { status: 400 });
  }

  const token = await sha256Hex(password);
  const existingHash = await getSetting(env.DB, 'passwordHash');

  if (!existingHash) {
    await setSetting(env.DB, 'passwordHash', token);
    return json({ ok: true, token, firstRun: true });
  }

  if (token !== existingHash) {
    return json({ ok: false, error: 'Incorrect password.' }, { status: 401 });
  }
  return json({ ok: true, token, firstRun: false });
}
