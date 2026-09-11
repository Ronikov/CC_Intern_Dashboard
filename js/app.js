// app.js — bootstraps the dashboard: password lock (backed by the D1-based
// API), tab routing, and top-level event wiring. Everything else lives in
// render.js / modals.js / store.js / github.js.

import { store, login, isUnlocked, lock } from './store.js';
import { renderOverview, renderProjects, renderPerson, renderSettings } from './render.js';

const lockScreen = document.getElementById('lock-screen');
const appRoot = document.getElementById('app');
const page = document.getElementById('page');
const tabsPeopleEl = document.getElementById('tabs-people');
const syncStatusEl = document.getElementById('sync-status');

/* ---------------- boot ---------------- */

async function boot() {
  if (isUnlocked()) {
    try {
      await store.load();
      enterApp();
      return;
    } catch (e) {
      // stale/invalid token (e.g. password changed elsewhere) — fall through to lock screen
      lock();
    }
  }
  lockScreen.hidden = false;
  wireLockForm();
}

/* ---------------- lock screen ---------------- */

function wireLockForm() {
  const form = document.getElementById('lock-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const val = document.getElementById('lock-password').value;
    const errEl = document.getElementById('lock-error');
    errEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const result = await login(val);
      await store.load();
      lockScreen.hidden = true;
      enterApp();
      if (result.firstRun) {
        setTimeout(() => alert('This password is now set as the shared password for everyone. You can change it later in Settings.'), 200);
      }
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message || 'Incorrect password.';
    } finally {
      submitBtn.disabled = false;
    }
  };
}

/* ---------------- app shell ---------------- */

let activeTab = 'overview';

function enterApp() {
  lockScreen.hidden = true;
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
    });
  }
  if (activeTab.startsWith('person:')) {
    return renderPerson(page, activeTab.split(':')[1]);
  }
  renderOverview(page);
}

boot();
