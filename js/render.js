// render.js — all page rendering. Vanilla DOM string templates + event
// delegation; no framework, no build step, so this deploys as-is to
// Cloudflare Pages.

import { store, colorVar, PALETTE, getConnection, saveConnection, sha256Hex } from './store.js';
import { parseRepoUrl, fetchIssues, fetchMilestones, fetchReleases } from './github.js';
import { openProjectModal } from './modals.js';

const repoCache = new Map(); // "owner/repo" -> { issues, milestones, releases, fetchedAt }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function avatar(person, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;` : '';
  return `<div class="avatar" style="background:${colorVar(person.color)};${style}" title="${esc(person.name)}">${esc(initials(person.name))}</div>`;
}

function statusBadge(status) {
  const map = {
    planning: ['Planning', 'var(--ink-faint)', 'var(--surface-2)'],
    active: ['Active', '#fff', 'var(--accent)'],
    'on-hold': ['On hold', '#fff', 'var(--warn)'],
    done: ['Done', '#fff', 'var(--good)'],
  };
  const [label, fg, bg] = map[status] || map.planning;
  return `<span class="badge" style="color:${fg};background:${bg};">${esc(label)}</span>`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

/* ==================================================================== */
/* OVERVIEW                                                              */
/* ==================================================================== */

export function renderOverview(el) {
  const people = store.getPeople();
  const projects = store.getProjects();

  const active = projects.filter((p) => p.status === 'active').length;
  const done = projects.filter((p) => p.status === 'done').length;

  el.innerHTML = `
    <div class="section-head">
      <div><h2>Overview</h2><p class="sub">Everything Camp Challenge is building, at a glance.</p></div>
    </div>
    <div class="stats-row">
      <div class="stat-tile"><div class="num">${projects.length}</div><div class="label">Total projects</div></div>
      <div class="stat-tile"><div class="num">${active}</div><div class="label">Active</div></div>
      <div class="stat-tile"><div class="num">${done}</div><div class="label">Shipped</div></div>
      <div class="stat-tile"><div class="num">${people.length}</div><div class="label">People</div></div>
    </div>
    ${renderTimeline(projects, people)}
    <div class="section-head"><div><h2>Who's doing what</h2></div></div>
    <div class="assign-grid">
      ${people.map((person) => renderAssignCard(person, store.projectsFor(person.id))).join('') || `<p class="empty-state">No people yet — add some in Settings.</p>`}
    </div>
  `;
}

function renderTimeline(projects, people) {
  const dated = projects.filter((p) => p.start && p.end);
  if (!dated.length) {
    return `<div class="timeline-wrap"><p class="empty-state">Add start/end dates to projects to see the combined timeline here.</p></div>`;
  }
  const minDate = new Date(Math.min(...dated.map((p) => new Date(p.start))));
  const maxDate = new Date(Math.max(...dated.map((p) => new Date(p.end))));
  const totalDays = Math.max(1, daysBetween(minDate, maxDate));

  const months = [];
  let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    months.push(cur.toLocaleString(undefined, { month: 'short', year: '2-digit' }));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  const rows = dated.map((p) => {
    const leftPct = (daysBetween(minDate, p.start) / totalDays) * 100;
    const widthPct = Math.max(1.5, (daysBetween(p.start, p.end) / totalDays) * 100);
    const owner = people.find((pe) => (p.assignees || [])[0] === pe.id);
    const color = owner ? colorVar(owner.color) : 'var(--ink-faint)';
    return `
      <div class="timeline-row">
        <div class="timeline-label"><span class="dot" style="background:${color}"></span>${esc(p.name)}</div>
        <div class="timeline-track">
          <div class="timeline-bar" data-project="${esc(p.id)}" style="left:${leftPct}%;width:${widthPct}%;background:${color};">${esc(p.name)}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="timeline-wrap">
      <div class="timeline">
        <div class="timeline-row timeline-head-row">
          <div class="timeline-label">Project</div>
          <div class="timeline-months">${months.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
        </div>
        ${rows}
      </div>
    </div>`;
}

function renderAssignCard(person, projects) {
  return `
    <div class="assign-card">
      <div class="head">${avatar(person, 36)}<span class="name">${esc(person.name)}</span></div>
      <div class="body">
        ${projects.length ? projects.map((p) => `
          <div class="assign-proj">
            <span>${esc(p.name)}</span>
            ${statusBadge(p.status)}
          </div>`).join('') : `<p class="empty-state" style="padding:14px 0;">No projects assigned</p>`}
      </div>
    </div>`;
}

/* ==================================================================== */
/* PROJECTS TAB                                                          */
/* ==================================================================== */

export function renderProjects(el) {
  const projects = store.getProjects();
  const people = store.getPeople();

  el.innerHTML = `
    <div class="section-head">
      <div><h2>Projects</h2><p class="sub">Create a project and assign who's driving it.</p></div>
      <button class="btn btn-primary" id="new-project-btn">+ New project</button>
    </div>
    <div class="project-grid">
      ${projects.map((p) => renderProjectCard(p, people)).join('') || `<p class="empty-state">No projects yet. Click “New project” to add the first one.</p>`}
    </div>
  `;

  el.querySelector('#new-project-btn').addEventListener('click', () => openProjectModal());
  el.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', () => openProjectModal(card.dataset.id));
  });
}

function renderProjectCard(p, people) {
  const owners = (p.assignees || []).map((id) => people.find((pe) => pe.id === id)).filter(Boolean);
  const parsed = parseRepoUrl(p.repoUrl);
  return `
    <div class="project-card" data-id="${esc(p.id)}" style="border-left-color:${owners[0] ? colorVar(owners[0].color) : 'var(--accent)'}">
      <div class="top"><h3>${esc(p.name)}</h3>${statusBadge(p.status)}</div>
      <p class="desc">${esc(p.description || 'No description yet.')}</p>
      <div class="meta">
        <div class="avatars">${owners.map((o) => avatar(o, 24)).join('') || '<span class="badge">Unassigned</span>'}</div>
      </div>
      ${parsed ? `<a class="repo-link" href="${esc(p.repoUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">⌥ ${esc(parsed.owner)}/${esc(parsed.repo)}</a>` : ''}
    </div>`;
}

/* ==================================================================== */
/* PERSON TAB                                                            */
/* ==================================================================== */

let openDetailProjectId = null;
let activeSubtab = 'kanban';

export function renderPerson(el, personId) {
  const person = store.getPerson(personId);
  if (!person) {
    el.innerHTML = `<p class="empty-state">Person not found.</p>`;
    return;
  }
  const projects = store.projectsFor(personId);

  el.innerHTML = `
    <div class="person-header">
      ${avatar(person, 52)}
      <div>
        <h2>${esc(person.name)}'s board</h2>
        <p class="sub">${projects.length} project${projects.length === 1 ? '' : 's'} assigned</p>
      </div>
    </div>
    <div class="board-grid">
      ${projects.map((p) => renderBoardCard(p)).join('') || `<p class="empty-state">No projects assigned to ${esc(person.name)} yet — assign one from the Projects tab.</p>`}
    </div>
    <div id="project-detail-slot"></div>
  `;

  el.querySelectorAll('.board-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      openDetailProjectId = openDetailProjectId === id ? null : id;
      activeSubtab = 'kanban';
      renderPerson(el, personId);
    });
  });

  if (openDetailProjectId && projects.some((p) => p.id === openDetailProjectId)) {
    const slot = el.querySelector('#project-detail-slot');
    renderProjectDetail(slot, store.getProject(openDetailProjectId));
  }
}

function renderBoardCard(p) {
  const active = p.id === openDetailProjectId;
  return `
    <div class="board-card ${active ? 'active' : ''}" data-id="${esc(p.id)}">
      <div class="head">
        <h3>${esc(p.name)}</h3>
        <div class="status-row">${statusBadge(p.status)}<span class="meta" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-faint);">${esc(p.category || '')}</span></div>
      </div>
      <div class="body">${esc(p.description || 'No description yet.')}</div>
    </div>`;
}

function renderProjectDetail(slot, project) {
  const parsed = parseRepoUrl(project.repoUrl);

  slot.innerHTML = `
    <div class="detail-panel">
      <div class="dp-head">
        <h3>${esc(project.name)}</h3>
        ${parsed ? `<a class="btn btn-ghost btn-small" href="${esc(project.repoUrl)}" target="_blank" rel="noopener">View on GitHub ↗</a>` : `<span class="settings-note">No GitHub repo linked — add one by editing this project.</span>`}
      </div>
      ${parsed ? `
        <div class="subtabs">
          ${['kanban', 'bugs', 'roadmap', 'launch'].map((t) => `<button class="subtab ${t === activeSubtab ? 'active' : ''}" data-sub="${t}">${label(t)}</button>`).join('')}
        </div>
        <div class="subtab-body" id="subtab-body"><p class="loading-state">Loading from GitHub…</p></div>
      ` : ''}
    </div>`;

  if (!parsed) return;

  slot.querySelectorAll('.subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSubtab = btn.dataset.sub;
      slot.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b === btn));
      loadAndRenderSubtab(slot.querySelector('#subtab-body'), parsed, activeSubtab);
    });
  });

  loadAndRenderSubtab(slot.querySelector('#subtab-body'), parsed, activeSubtab);
}

function label(t) {
  return { kanban: 'Kanban', bugs: 'Bug tracker', roadmap: 'Roadmap', launch: 'Product launch' }[t];
}

async function getRepoBundle(parsed) {
  const key = `${parsed.owner}/${parsed.repo}`;
  const cached = repoCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 60000) return cached;

  const conn = getConnection();
  const token = conn?.token;
  const [issues, milestones, releases] = await Promise.all([
    fetchIssues(parsed, token, 'all').catch(() => []),
    fetchMilestones(parsed, token, 'open').catch(() => []),
    fetchReleases(parsed, token).catch(() => []),
  ]);
  const bundle = { issues, milestones, releases, fetchedAt: Date.now() };
  repoCache.set(key, bundle);
  return bundle;
}

async function loadAndRenderSubtab(container, parsed, tab) {
  container.innerHTML = `<p class="loading-state">Loading from GitHub…</p>`;
  let bundle;
  try {
    bundle = await getRepoBundle(parsed);
  } catch (e) {
    container.innerHTML = `<p class="empty-state">Couldn't load data from GitHub (${esc(e.message)}). If this is a private repo, add a token in Settings.</p>`;
    return;
  }

  if (tab === 'kanban') return renderKanban(container, bundle.issues);
  if (tab === 'bugs') return renderBugs(container, bundle.issues);
  if (tab === 'roadmap') return renderRoadmap(container, bundle.milestones, bundle.issues);
  if (tab === 'launch') return renderLaunch(container, bundle.releases);
}

function issueLabelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
}

function renderKanban(container, issues) {
  const open = issues.filter((i) => i.state === 'open');
  const done = issues.filter((i) => i.state === 'closed');
  const cols = {
    Backlog: open.filter((i) => !issueLabelNames(i).some((l) => ['in progress', 'in-progress', 'todo', 'to do'].includes(l))),
    'To do': open.filter((i) => issueLabelNames(i).some((l) => ['todo', 'to do'].includes(l))),
    'In progress': open.filter((i) => issueLabelNames(i).some((l) => ['in progress', 'in-progress'].includes(l))),
    Done: done,
  };
  container.innerHTML = `
    <div class="kanban">
      ${Object.entries(cols).map(([name, items]) => `
        <div class="kanban-col">
          <h4>${esc(name)} · ${items.length}</h4>
          ${items.slice(0, 25).map((i) => kanbanCard(i)).join('') || '<p class="empty-state" style="padding:6px 0;">Empty</p>'}
        </div>`).join('')}
    </div>
    ${issues.length ? '' : '<p class="empty-state">No issues found in this repo.</p>'}
  `;
}

function kanbanCard(issue) {
  return `
    <div class="kanban-card">
      <a href="${esc(issue.html_url)}" target="_blank" rel="noopener">#${issue.number} ${esc(issue.title)}</a>
      <div class="labels">${(issue.labels || []).map((l) => {
        const name = typeof l === 'string' ? l : l.name;
        const color = typeof l === 'string' ? 'EAE1D2' : (l.color || 'EAE1D2');
        return `<span class="lbl" style="background:#${color}33;color:#${color === 'EAE1D2' ? '58567A' : color};">${esc(name)}</span>`;
      }).join('')}</div>
    </div>`;
}

function renderBugs(container, issues) {
  const bugs = issues.filter((i) => issueLabelNames(i).includes('bug'));
  const open = bugs.filter((b) => b.state === 'open');
  const closed = bugs.filter((b) => b.state === 'closed');
  container.innerHTML = `
    <div class="stats-row" style="margin-bottom:16px;">
      <div class="stat-tile"><div class="num">${open.length}</div><div class="label">Open bugs</div></div>
      <div class="stat-tile"><div class="num">${closed.length}</div><div class="label">Closed bugs</div></div>
    </div>
    ${bugs.length ? bugs.map((b) => `
      <div class="list-row">
        <a href="${esc(b.html_url)}" target="_blank" rel="noopener">#${b.number} ${esc(b.title)}</a>
        <span class="badge" style="background:${b.state === 'open' ? 'var(--bad-soft)' : 'var(--good-soft)'};color:${b.state === 'open' ? 'var(--bad)' : 'var(--good)'};">${b.state}</span>
      </div>`).join('') : `<p class="empty-state">No issues labeled “bug” in this repo.</p>`}
  `;
}

function renderRoadmap(container, milestones, issues) {
  if (!milestones.length) {
    container.innerHTML = `<p class="empty-state">No open milestones — create some on GitHub to power the roadmap.</p>`;
    return;
  }
  container.innerHTML = milestones.map((m) => {
    const total = m.open_issues + m.closed_issues;
    const pct = total ? Math.round((m.closed_issues / total) * 100) : 0;
    return `
      <div class="list-row" style="display:block;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <a href="${esc(m.html_url)}" target="_blank" rel="noopener">${esc(m.title)}</a>
          <span class="meta">${m.due_on ? new Date(m.due_on).toLocaleDateString() : 'no due date'}</span>
        </div>
        <div class="progress-bar"><div style="width:${pct}%;"></div></div>
        <span class="meta">${m.closed_issues}/${total} issues closed</span>
      </div>`;
  }).join('');
}

function renderLaunch(container, releases) {
  if (!releases.length) {
    container.innerHTML = `<p class="empty-state">No releases published yet.</p>`;
    return;
  }
  container.innerHTML = releases.map((r) => `
    <div class="list-row">
      <a href="${esc(r.html_url)}" target="_blank" rel="noopener">${esc(r.name || r.tag_name)}</a>
      <span class="meta">${r.published_at ? new Date(r.published_at).toLocaleDateString() : 'draft'}</span>
    </div>`).join('');
}

/* ==================================================================== */
/* SETTINGS TAB                                                          */
/* ==================================================================== */

export function renderSettings(el, { onPeopleChanged, onDisconnect }) {
  const conn = getConnection();
  const people = store.getPeople();

  el.innerHTML = `
    <div class="section-head"><div><h2>Settings</h2><p class="sub">Manage people and where the dashboard's data lives.</p></div></div>
    <div class="settings-grid">
      <div class="settings-card">
        <h3>People</h3>
        <div class="people-list" id="people-list">
          ${people.map((p) => `
            <div class="person-row" data-id="${esc(p.id)}">
              ${avatar(p, 28)}
              <span class="name">${esc(p.name)}</span>
              <div class="swatches">
                ${PALETTE.map((c) => `<span class="swatch ${c === p.color ? 'selected' : ''}" data-color="${c}" style="background:${colorVar(c)}"></span>`).join('')}
              </div>
              <button class="btn btn-ghost btn-small remove-person" title="Remove">✕</button>
            </div>`).join('')}
        </div>
        <div class="field-row">
          <input type="text" id="new-person-name" placeholder="Add a person…">
          <button class="btn btn-primary btn-small" id="add-person-btn">Add</button>
        </div>
        <p class="settings-note">Each person automatically gets their own tab in the top navigation.</p>
      </div>

      <div class="settings-card">
        <h3>Data connection</h3>
        <p class="settings-note">Projects &amp; people live in <b>${esc(conn?.owner)}/${esc(conn?.repo)}</b> at <code>${esc(conn?.path)}</code> (branch <code>${esc(conn?.branch)}</code>). The token is stored only in this browser.</p>
        <div class="field-row"><input type="password" id="token-input" placeholder="Update GitHub token" value=""></div>
        <button class="btn btn-small" id="save-token-btn">Save token</button>
        <button class="btn btn-small btn-danger" id="disconnect-btn" style="margin-left:8px;">Disconnect this device</button>
      </div>

      <div class="settings-card">
        <h3>Change shared password</h3>
        <div class="field-row"><input type="password" id="new-password" placeholder="New password"></div>
        <button class="btn btn-primary btn-small" id="save-password-btn">Update password</button>
        <p class="settings-note">Everyone with the link will need this new password next time they unlock the dashboard.</p>
      </div>
    </div>
  `;

  el.querySelector('#add-person-btn').addEventListener('click', async () => {
    const input = el.querySelector('#new-person-name');
    const name = input.value.trim();
    if (!name) return;
    const usedColors = new Set(people.map((p) => p.color));
    const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[people.length % PALETTE.length];
    store.data.people.push({ id: store.nextId('person'), name, color });
    input.value = '';
    await onPeopleChanged();
  });

  el.querySelectorAll('.remove-person').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.person-row').dataset.id;
      if (!confirm('Remove this person? They will also be unassigned from any projects.')) return;
      store.data.people = store.data.people.filter((p) => p.id !== id);
      store.data.projects.forEach((p) => { p.assignees = (p.assignees || []).filter((a) => a !== id); });
      await onPeopleChanged();
    });
  });

  el.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', async (e) => {
      const id = e.target.closest('.person-row').dataset.id;
      const person = store.getPerson(id);
      person.color = e.target.dataset.color;
      await onPeopleChanged();
    });
  });

  el.querySelector('#save-token-btn').addEventListener('click', () => {
    const token = el.querySelector('#token-input').value.trim();
    if (!token) return;
    const c = getConnection();
    c.token = token;
    saveConnection(c);
    alert('Token updated for this device.');
  });

  el.querySelector('#disconnect-btn').addEventListener('click', () => {
    if (!confirm('Disconnect this device from the data repo? You can reconnect anytime with the same details.')) return;
    onDisconnect();
  });

  el.querySelector('#save-password-btn').addEventListener('click', async () => {
    const val = el.querySelector('#new-password').value;
    if (!val) return;
    store.data.passwordHash = await sha256Hex(val);
    await store.save('Update shared password');
    alert('Password updated.');
  });
}
