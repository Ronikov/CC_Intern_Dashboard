// app.js — bootstraps the dashboard: first-run setup, password lock, tab
// routing, and top-level event wiring. Everything else lives in render.js /
// modals.js / store.js / github.js.

import { store, getConnection, saveConnection, clearConnection, isUnlocked, setUnlocked, lock, sha256Hex } from './store.js';
import { renderOverview, renderProjects, renderPerson, renderSettings } from './render.js';

const setupScreen = document.getElementById('setup-screen');
const lockScreen = document.getElementById('lock-screen');
const appRoot = document.getElementById('app');
const page = document.getElementById('page');
const tabsPeopleEl = document.getElementById('tabs-people');
const syncStatusEl = document.getElementById('sync-status');

/* ---------------- boot ---------------- */

async function boot() {
  const conn = getConnection();
  if (!conn) {
    setupScreen.hidden = false;
    wireSetupForm();
    return;
  }

  try {
    await store.load();
  } catch (e) {
    setupScreen.hidden = false;
    document.getElementById('setup-error').hidden = false;
    document.getElementById('setup-error').textContent = `Couldn't load data: ${e.message}. Check your details and try again, or reconnect below.`;
    prefillSetupForm(conn);
    wireSetupForm();
    return;
  }

  if (!store.data.passwordHash) {
    // first run on this data file: skip the lock, land in the app, nudge toward Settings.
    setUnlocked();
    enterApp();
    return;
  }

  if (isUnlocked()) {
    enterApp();
  } else {
    lockScreen.hidden = false;
    wireLockForm();
  }
}

/* ---------------- first-run setup ---------------- */

function prefillSetupForm(conn) {
  document.getElementById('setup-owner').value = conn.owner || '';
  document.getElementById('setup-repo').value = conn.repo || '';
  document.getElementById('setup-path').value = conn.path || 'dashboard-data.json';
  document.getElementById('setup-branch').value = conn.branch || 'main';
}

function wireSetupForm() {
  const form = document.getElementById('setup-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const conn = {
      owner: document.getElementById('setup-owner').value.trim(),
      repo: document.getElementById('setup-repo').value.trim(),
      path: document.getElementById('setup-path').value.trim() || 'dashboard-data.json',
      branch: document.getElementById('setup-branch').value.trim() || 'main',
      token: document.getElementById('setup-token').value.trim(),
    };
    saveConnection(conn);
    const errEl = document.getElementById('setup-error');
    errEl.hidden = true;
    try {
      await store.load();
      if (!store.data.passwordHash) {
        // brand new data file: initialize it so the repo has something committed.
        await store.save('Initialize Camp Challenge dashboard data');
      }
      setupScreen.hidden = true;
      boot();
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = `Couldn't connect: ${err.message}`;
    }
  };
}

/* ---------------- lock screen ---------------- */

function wireLockForm() {
  const form = document.getElementById('lock-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const val = document.getElementById('lock-password').value;
    const hash = await sha256Hex(val);
    const errEl = document.getElementById('lock-error');
    if (hash === store.data.passwordHash) {
      setUnlocked();
      lockScreen.hidden = true;
      enterApp();
    } else {
      errEl.hidden = false;
      errEl.textContent = 'Incorrect password.';
    }
  };
}

/* ---------------- app shell ---------------- */

let activeTab = 'overview';

function enterApp() {
  lockScreen.hidden = true;
  setupScreen.hidden = true;
  appRoot.hidden = false;

  renderPeopleTabs();

  const hashTab = location.hash.replace('#/', '');
  activeTab = hashTab || 'overview';
  renderActiveTab();

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    location.hash = `#/${activeTab}`;
    renderActiveTab();
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await store.load();
    renderPeopleTabs();
    renderActiveTab();
  });

  document.getElementById('lock-btn').addEventListener('click', () => {
    lock();
    location.reload();
  });

  store.on(() => updateSyncStatus());
  updateSyncStatus();

  window.addEventListener('dashboard:changed', () => {
    renderPeopleTabs();
    renderActiveTab();
  });
}

function updateSyncStatus() {
  const map = {
    idle: ['● synced', ''],
    synced: ['● synced', ''],
    syncing: ['● saving…', 'syncing'],
    error: ['● sync error', 'error'],
  };
  const [text, cls] = map[store.status] || map.idle;
  syncStatusEl.textContent = text;
  syncStatusEl.className = `sync-status ${cls}`;
}

function renderPeopleTabs() {
  const people = store.getPeople();
  tabsPeopleEl.innerHTML = people.map((p) => `<button class="tab" data-tab="person:${p.id}">${escapeHtml(p.name)}</button>`).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderActiveTab() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));

  if (activeTab === 'overview') return renderOverview(page);
  if (activeTab === 'projects') return renderProjects(page);
  if (activeTab === 'settings') {
    return renderSettings(page, {
      onPeopleChanged: async () => {
        await store.save('Update people');
        renderPeopleTabs();
        renderActiveTab();
      },
      onDisconnect: () => {
        clearConnection();
        location.reload();
      },
    });
  }
  if (activeTab.startsWith('person:')) {
    return renderPerson(page, activeTab.split(':')[1]);
  }
  renderOverview(page);
}

boot();
