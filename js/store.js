// store.js — local connection config, remote data (people/projects) state,
// and small persistence/sync helpers. GitHub is the source of truth for
// people/projects; the connection itself (which repo, and the PAT) lives only
// in this browser's localStorage.

import { fetchDataFile, saveDataFile } from './github.js';

const CONN_KEY = 'cc_dashboard_conn_v1';
const UNLOCK_KEY = 'cc_dashboard_unlocked_v1';

export const PALETTE = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

export function colorVar(key) {
  return `var(--${key})`;
}
export function colorSoftVar(key) {
  return `var(--${key}-soft)`;
}

/* ---------------- connection (local, per-device) ---------------- */

export function getConnection() {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConnection(conn) {
  localStorage.setItem(CONN_KEY, JSON.stringify(conn));
}

export function clearConnection() {
  localStorage.removeItem(CONN_KEY);
  localStorage.removeItem(UNLOCK_KEY);
}

/* ---------------- unlock (session, per-device) ---------------- */

export function isUnlocked() {
  return sessionStorage.getItem(UNLOCK_KEY) === '1';
}
export function setUnlocked() {
  sessionStorage.setItem(UNLOCK_KEY, '1');
}
export function lock() {
  sessionStorage.removeItem(UNLOCK_KEY);
}

/* ---------------- password hashing ---------------- */

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- default data shape ---------------- */

function defaultData() {
  return {
    version: 1,
    passwordHash: null, // set on first run
    people: [
      { id: 'zul', name: 'Zul', color: 'p1' },
      { id: 'marc', name: 'Marc', color: 'p2' },
    ],
    projects: [],
  };
}

/* ---------------- central store ---------------- */

class Store {
  constructor() {
    this.data = null;
    this.sha = null;
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
    const conn = getConnection();
    if (!conn) throw new Error('no-connection');
    this.setStatus('syncing');
    try {
      const { sha, data } = await fetchDataFile(conn);
      this.sha = sha;
      this.data = data || defaultData();
      this.setStatus('synced');
    } catch (e) {
      this.setStatus('error', e.message);
      throw e;
    }
    return this.data;
  }

  async save(message) {
    const conn = getConnection();
    if (!conn) throw new Error('no-connection');
    this.setStatus('syncing');
    try {
      const sha = await saveDataFile(conn, this.data, this.sha, message);
      this.sha = sha;
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
