// modals.js — the "new / edit project" modal, and the "import repos from
// GitHub" modal used by the Projects tab's "Sync from GitHub" button.

import { store } from './store.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

export function openProjectModal(projectId) {
  const existing = projectId ? store.getProject(projectId) : null;
  const people = store.getPeople();
  const p = existing || { name: '', description: '', repoUrl: '', category: '', status: 'planning', assignees: [], start: '', end: '' };

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <h2>${existing ? 'Edit project' : 'New project'}</h2>
        <label>Name</label>
        <input type="text" id="f-name" value="${esc(p.name)}" placeholder="e.g. Fall Delivery Site">
        <label>Description</label>
        <textarea id="f-desc" placeholder="What is this project?">${esc(p.description)}</textarea>
        <label>GitHub repo URL</label>
        <input type="text" id="f-repo" value="${esc(p.repoUrl)}" placeholder="https://github.com/owner/repo">
        <label>Category</label>
        <input type="text" id="f-category" value="${esc(p.category)}" placeholder="e.g. Website, App, Ops">
        <label>Status</label>
        <select id="f-status">
          ${['planning', 'active', 'on-hold', 'done'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <label>Assign people</label>
        <div class="checkbox-grid" id="f-assignees">
          ${people.map((per) => `<span class="check-pill ${p.assignees.includes(per.id) ? 'on' : ''}" data-id="${per.id}">${esc(per.name)}</span>`).join('') || '<span class="settings-note">Add people in Settings first.</span>'}
        </div>
        <label>Start date</label>
        <input type="date" id="f-start" value="${esc(p.start)}">
        <label>End date</label>
        <input type="date" id="f-end" value="${esc(p.end)}">
        <div class="modal-actions">
          ${existing ? '<button class="btn btn-danger" id="f-delete">Delete</button>' : ''}
          <button class="btn btn-ghost" id="f-cancel">Cancel</button>
          <button class="btn btn-primary" id="f-save">${existing ? 'Save changes' : 'Create project'}</button>
        </div>
      </div>
    </div>
  `;

  const assignees = new Set(p.assignees);
  root.querySelectorAll('#f-assignees .check-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const id = pill.dataset.id;
      if (assignees.has(id)) { assignees.delete(id); pill.classList.remove('on'); }
      else { assignees.add(id); pill.classList.add('on'); }
    });
  });

  root.querySelector('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  root.querySelector('#f-cancel').addEventListener('click', closeModal);

  if (existing) {
    root.querySelector('#f-delete').addEventListener('click', async () => {
      if (!confirm(`Delete "${existing.name}"? This can't be undone.`)) return;
      store.data.projects = store.data.projects.filter((pr) => pr.id !== existing.id);
      await store.save(`Delete project: ${existing.name}`);
      closeModal();
      window.dispatchEvent(new CustomEvent('dashboard:changed'));
    });
  }

  root.querySelector('#f-save').addEventListener('click', async () => {
    const name = root.querySelector('#f-name').value.trim();
    if (!name) { root.querySelector('#f-name').focus(); return; }
    const record = {
      id: existing ? existing.id : store.nextId('proj'),
      name,
      description: root.querySelector('#f-desc').value.trim(),
      repoUrl: root.querySelector('#f-repo').value.trim(),
      category: root.querySelector('#f-category').value.trim(),
      status: root.querySelector('#f-status').value,
      assignees: Array.from(assignees),
      start: root.querySelector('#f-start').value,
      end: root.querySelector('#f-end').value,
    };

    if (existing) {
      Object.assign(existing, record);
    } else {
      store.data.projects.push(record);
    }

    const saveBtn = root.querySelector('#f-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await store.save(existing ? `Update project: ${name}` : `Add project: ${name}`);
      closeModal();
      window.dispatchEvent(new CustomEvent('dashboard:changed'));
    } catch (e) {
      alert(`Couldn't save to GitHub: ${e.message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save changes' : 'Create project';
    }
  });
}

function humanize(repoName) {
  return repoName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// repos: [{ name, fullName, htmlUrl, description, updatedAt, archived }]
export function openImportReposModal(repos) {
  const root = document.getElementById('modal-root');
  const selected = new Set(repos.map((r) => r.htmlUrl));

  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <h2>Import from GitHub</h2>
        <p class="settings-note">Found ${repos.length} repo${repos.length === 1 ? '' : 's'} the token can see that aren't tracked as a project yet. Pick which to add:</p>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px; max-height:40vh; overflow-y:auto;">
          ${repos.map((r) => `
            <label class="check-pill on" style="justify-content:space-between; width:100%; cursor:pointer;" data-url="${esc(r.htmlUrl)}">
              <span><b>${esc(r.fullName)}</b>${r.private ? ' 🔒' : ''}${r.description ? ` — ${esc(r.description)}` : ''}</span>
              <input type="checkbox" class="repo-checkbox" checked data-url="${esc(r.htmlUrl)}">
            </label>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="f-cancel">Cancel</button>
          <button class="btn btn-primary" id="f-import">Import selected</button>
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('.repo-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const url = cb.dataset.url;
      if (cb.checked) selected.add(url);
      else selected.delete(url);
      cb.closest('.check-pill').classList.toggle('on', cb.checked);
    });
  });

  root.querySelector('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  root.querySelector('#f-cancel').addEventListener('click', closeModal);

  root.querySelector('#f-import').addEventListener('click', async () => {
    const toImport = repos.filter((r) => selected.has(r.htmlUrl));
    if (!toImport.length) { closeModal(); return; }

    const btn = root.querySelector('#f-import');
    btn.disabled = true;
    btn.textContent = 'Importing…';

    toImport.forEach((r) => {
      store.data.projects.push({
        id: store.nextId('proj'),
        name: humanize(r.name),
        description: r.description || '',
        repoUrl: r.htmlUrl,
        category: '',
        status: 'planning',
        assignees: [],
        start: '',
        end: '',
      });
    });

    try {
      await store.save(`Import ${toImport.length} project(s) from GitHub`);
      closeModal();
      window.dispatchEvent(new CustomEvent('dashboard:changed'));
    } catch (e) {
      alert(`Couldn't save: ${e.message}`);
      btn.disabled = false;
      btn.textContent = 'Import selected';
    }
  });
}
