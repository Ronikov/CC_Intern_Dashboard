// store.js — talks to our own Pages Functions API (backed by Cloudflare D1)
// for people/projects, and holds the in-memory app state. No GitHub token
// ever touches this file or the browser anymore; that lives server-side.

const TOKEN_KEY = 'cc_dashboard_token_v2';

export const PALETTE = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

export function colorVar(key) {
  return `var(--${key})`;
}

/* ---------------- session token (from /api/login) ---------------- */

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function isUnlocked() {
  return !!getToken();
}
export function lock() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function login(password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Incorrect password.');
  setToken(data.token);
  return data;
}

export async function updatePassword(newPassword) {
  const data = await apiFetch('/api/password', { method: 'PUT', body: JSON.stringify({ newPassword }) });
  setToken(data.token);
}

export async function getGithubTokenStatus() {
  return apiFetch('/api/github-token'); // { isSet, hint }
}

export async function setGithubToken(token) {
  return apiFetch('/api/github-token', { method: 'PUT', body: JSON.stringify({ token }) });
}

/* ---------------- central store ---------------- */

class Store {
  constructor() {
    this.data = null; // { people, projects }
    this.listeners = new Set();
    this.status = 'idle'; // idle | syncing | synced | error
    this.statusMsg = '';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn(this));
  }

  setStatus(status, msg = '') {
    this.status = status;
    this.statusMsg = msg;
    this.emit();
  }

  async load() {
    this.setStatus('syncing');
    try {
      this.data = await apiFetch('/api/state');
      this.setStatus('synced');
    } catch (e) {
      this.setStatus('error', e.message);
      throw e;
    }
    return this.data;
  }

  async save(message) {
    this.setStatus('syncing');
    try {
      await apiFetch('/api/state', { method: 'PUT', body: JSON.stringify(this.data) });
      this.setStatus('synced');
    } catch (e) {
      this.setStatus('error', e.message);
      throw e;
    }
  }

  getPeople() {
    return this.data?.people || [];
  }
  getPerson(id) {
    return this.getPeople().find((p) => p.id === id);
  }
  getProjects() {
    return this.data?.projects || [];
  }
  getProject(id) {
    return this.getProjects().find((p) => p.id === id);
  }
  projectsFor(personId) {
    return this.getProjects().filter((p) => (p.assignees || []).includes(personId));
  }

  nextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  }
}

export const store = new Store();
