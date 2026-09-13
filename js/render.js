// render.js — all page rendering. Vanilla DOM string templates + event
// delegation; no framework, no build step, so this deploys as-is to
// Cloudflare Pages.

import { store, colorVar, PALETTE, updatePassword, getGithubTokenStatus, setGithubToken } from './store.js';
import { parseRepoUrl, fetchIssues, fetchMilestones, fetchReleases, fetchAllRepos } from './github.js';
import { openProjectModal, openImportReposModal } from './modals.js';

const repoCache = new Map(); // "owner/repo" -> { issues, milestones, releases, fetchedAt }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function avatarFallbackHtml(person, style) {
  return `<div class="avatar" style="background:${colorVar(person.color)};${style}" title="${esc(person.name)}">${esc(initials(person.name))}</div>`;
}

function jsStringEscape(html) {
  return html.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Real GitHub avatar when the person has a username on file; falls back to
// their initials on a colored circle (also used if the GitHub image 404s).
function avatar(person, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;` : '';
  if (person.githubUsername) {
    const url = `https://github.com/${encodeURIComponent(person.githubUsername)}.png?size=128`;
    const fallback = jsStringEscape(avatarFallbackHtml(person, style));
    return `<img class="avatar" src="${url}" alt="${esc(person.name)}" title="${esc(person.name)} (@${esc(person.githubUsername)})" style="${style}object-fit:cover;" onerror='this.outerHTML="${fallback}"'>`;
  }
  return avatarFallbackHtml(person, style);
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
    <div class="section-head"><div><h2>Projects</h2><p class="sub">Who's on it, and what's next.</p></div></div>
    <div class="project-grid">
      ${projects.map((p) => renderOverviewProjectCard(p, people)).join('') || `<p class="empty-state">No projects yet — add one from the Projects tab.</p>`}
    </div>
  `;

  el.querySelectorAll('.person-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      goToPersonProject(a.dataset.person, a.dataset.project);
    });
  });

  projects.forEach((p) => {
    const parsed = parseRepoUrl(p.repoUrl);
    if (!parsed) return;
    const slot = el.querySelector(`#ov-milestone-${cssEscape(p.id)}`);
    if (!slot) return;
    getRepoBundle(parsed)
      .then((bundle) => { slot.innerHTML = renderMilestoneSummary(bundle.milestones); })
      .catch(() => { slot.innerHTML = `<p class="settings-note">Couldn't load milestone.</p>`; });
  });
}

function cssEscape(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function renderOverviewProjectCard(project, people) {
  const owners = (project.assignees || []).map((id) => people.find((pe) => pe.id === id)).filter(Boolean);
  const parsed = parseRepoUrl(project.repoUrl);
  return `
    <div class="project-card" style="border-left-color:${owners[0] ? colorVar(owners[0].color) : 'var(--accent)'}; cursor:default;">
      <div class="top"><h3>${esc(project.name)}</h3>${statusBadge(project.status)}</div>
      <div class="ov-members">
        ${owners.length ? owners.map((o) => `
          <a href="#" class="person-link" data-person="${esc(o.id)}" data-project="${esc(project.id)}">
            ${avatar(o, 22)}<span>${esc(o.name)}</span>
          </a>`).join('') : '<span class="badge">Unassigned</span>'}
      </div>
      <div class="ov-milestone" id="ov-milestone-${cssEscape(project.id)}">
        ${parsed ? `<p class="loading-state" style="padding:4px 0;text-align:left;">Loading milestone…</p>` : `<p class="settings-note">Not linked to GitHub</p>`}
      </div>
    </div>`;
}

function renderMilestoneSummary(milestones) {
  const open = (milestones || []).filter((m) => m.state === 'open');
  if (!open.length) return `<p class="settings-note">No open milestones</p>`;
  const m = open[0];
  const total = m.open_issues + m.closed_issues;
  const pct = total ? Math.round((m.closed_issues / total) * 100) : 0;
  return `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="font-size:12.5px;font-weight:600;">🏁 ${esc(m.title)}</span>
        <span class="meta">${m.due_on ? new Date(m.due_on).toLocaleDateString() : 'no due date'}</span>
      </div>
      <div class="progress-bar"><div style="width:${pct}%;"></div></div>
    </div>`;
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

// Bridges Overview's "click a name" to the person tab's project detail view.
// app.js listens for 'dashboard:navigate' and does the actual tab switch.
export function goToPersonProject(personId, projectId) {
  openDetailProjectId = projectId;
  activeSubtab = 'kanban';
  window.dispatchEvent(new CustomEvent('dashboard:navigate', { detail: { tab: `person:${personId}` } }));
}

/* ==================================================================== */
/* PROJECTS TAB                                                          */
/* ==================================================================== */

let expandedProjectId = null;

export function renderProjects(el) {
  const projects = store.getProjects();
  const people = store.getPeople();

  el.innerHTML = `
    <div class="section-head">
      <div><h2>Projects</h2><p class="sub">Click a project for its combined view — Kanban, bugs, roadmap &amp; launch. Use ✎ to edit details.</p></div>
      <div style="display:flex;gap:8px;">
        <button class="btn" id="sync-github-btn">↻ Sync from GitHub</button>
        <button class="btn btn-primary" id="new-project-btn">+ New project</button>
      </div>
    </div>
    <div class="project-grid">
      ${projects.map((p) => renderProjectCard(p, people)).join('') || `<p class="empty-state">No projects yet. Click “New project” to add the first one, or “Sync from GitHub” to pull in existing repos.</p>`}
    </div>
    <div id="project-overview-detail-slot"></div>
  `;

  el.querySelector('#new-project-btn').addEventListener('click', () => openProjectModal());
  el.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      expandedProjectId = expandedProjectId === id ? null : id;
      renderProjects(el);
    });
  });
  el.querySelectorAll('.edit-project-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProjectModal(btn.dataset.id);
    });
  });
  el.querySelector('#sync-github-btn').addEventListener('click', (e) => syncFromGithub(e.currentTarget));

  if (expandedProjectId && projects.some((p) => p.id === expandedProjectId)) {
    renderProjectDetail(el.querySelector('#project-overview-detail-slot'), store.getProject(expandedProjectId));
  }
}

async function syncFromGithub(btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    const repos = await fetchAllRepos();
    const existing = new Set(
      store.getProjects()
        .map((p) => parseRepoUrl(p.repoUrl))
        .filter(Boolean)
        .map((r) => `${r.owner}/${r.repo}`.toLowerCase())
    );
    const newRepos = repos.filter((r) => !r.archived && !existing.has(r.fullName.toLowerCase()));

    if (!newRepos.length) {
      alert(`No new repos found — everything the token can see is already tracked (or archived).`);
      return;
    }
    openImportReposModal(newRepos);
  } catch (err) {
    alert(`Couldn't sync from GitHub: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderProjectCard(p, people) {
  const owners = (p.assignees || []).map((id) => people.find((pe) => pe.id === id)).filter(Boolean);
  const parsed = parseRepoUrl(p.repoUrl);
  const active = p.id === expandedProjectId;
  return `
    <div class="project-card ${active ? 'active' : ''}" data-id="${esc(p.id)}" style="border-left-color:${owners[0] ? colorVar(owners[0].color) : 'var(--accent)'}">
      <div class="top">
        <h3>${esc(p.name)}</h3>
        <div style="display:flex;align-items:center;gap:6px;flex:none;">
          ${statusBadge(p.status)}
          <button class="btn btn-ghost btn-small edit-project-btn" data-id="${esc(p.id)}" title="Edit project details">✎</button>
        </div>
      </div>
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
    <div class="section-head"><div><h2 style="font-size:17px;">Timeline</h2><p class="sub">Gantt view of ${esc(person.name)}'s projects.</p></div></div>
    ${renderTimeline(projects, store.getPeople())}
    <div class="section-head"><div><h2 style="font-size:17px;">Boards</h2></div></div>
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

  const [issues, milestones, releases] = await Promise.all([
    fetchIssues(parsed, null, 'all').catch(() => []),
    fetchMilestones(parsed, null, 'all').catch(() => []),
    fetchReleases(parsed).catch(() => []),
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
  if (tab === 'bugs') return renderBugs(container, bundle.issues, store.getPeople());
  if (tab === 'roadmap') return renderRoadmap(container, bundle.milestones);
  if (tab === 'launch') return renderLaunch(container, bundle.releases);
}

function issueLabelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
}

function issueAssignees(issue) {
  return issue.assignees?.length ? issue.assignees : (issue.assignee ? [issue.assignee] : []);
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
  const assignees = issueAssignees(issue);
  return `
    <div class="kanban-card">
      <div class="kc-top">
        <a href="${esc(issue.html_url)}" target="_blank" rel="noopener">#${issue.number} ${esc(issue.title)}</a>
        ${assignees.length ? `<div class="mini-avatars">${assignees.slice(0, 3).map((a) => `<img class="mini-avatar" src="${esc(a.avatar_url)}" alt="${esc(a.login)}" title="Assigned to @${esc(a.login)} on GitHub">`).join('')}</div>` : ''}
      </div>
      <div class="labels">${(issue.labels || []).map((l) => {
        const name = typeof l === 'string' ? l : l.name;
        const color = typeof l === 'string' ? 'EAE1D2' : (l.color || 'EAE1D2');
        return `<span class="lbl" style="background:#${color}33;color:#${color === 'EAE1D2' ? '58567A' : color};">${esc(name)}</span>`;
      }).join('')}</div>
    </div>`;
}

let bugFilterPersonId = 'all';

function renderBugs(container, issues, people) {
  const filterable = (people || []).filter((p) => p.githubUsername);
  const allBugs = issues.filter((i) => issueLabelNames(i).includes('bug'));

  const filterPerson = filterable.find((p) => p.id === bugFilterPersonId);
  const bugs = filterPerson
    ? allBugs.filter((b) => issueAssignees(b).some((a) => a.login?.toLowerCase() === filterPerson.githubUsername.toLowerCase()))
    : allBugs;

  const open = bugs.filter((b) => b.state === 'open');
  const closed = bugs.filter((b) => b.state === 'closed');

  container.innerHTML = `
    ${filterable.length ? `
      <div class="checkbox-grid" style="margin-bottom:14px;">
        <span class="check-pill ${bugFilterPersonId === 'all' ? 'on' : ''}" data-person="all">All</span>
        ${filterable.map((p) => `<span class="check-pill ${bugFilterPersonId === p.id ? 'on' : ''}" data-person="${esc(p.id)}">${avatar(p, 16)}${esc(p.name)}</span>`).join('')}
      </div>
    ` : ''}
    <div class="stats-row" style="margin-bottom:16px;">
      <div class="stat-tile"><div class="num">${open.length}</div><div class="label">Open bugs</div></div>
      <div class="stat-tile"><div class="num">${closed.length}</div><div class="label">Closed bugs</div></div>
    </div>
    ${bugs.length ? bugs.map((b) => {
      const assignees = issueAssignees(b);
      return `
      <div class="list-row">
        <a href="${esc(b.html_url)}" target="_blank" rel="noopener">#${b.number} ${esc(b.title)}</a>
        <div style="display:flex;align-items:center;gap:8px;">
          ${assignees.length ? `<div class="mini-avatars">${assignees.slice(0, 3).map((a) => `<img class="mini-avatar" src="${esc(a.avatar_url)}" alt="${esc(a.login)}" title="Assigned to @${esc(a.login)} on GitHub">`).join('')}</div>` : ''}
          <span class="badge" style="background:${b.state === 'open' ? 'var(--bad-soft)' : 'var(--good-soft)'};color:${b.state === 'open' ? 'var(--bad)' : 'var(--good)'};">${b.state}</span>
        </div>
      </div>`;
    }).join('') : `<p class="empty-state">No issues labeled “bug”${filterPerson ? ` assigned to ${esc(filterPerson.name)}` : ''} in this repo.</p>`}
  `;

  container.querySelectorAll('.check-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      bugFilterPersonId = pill.dataset.person;
      renderBugs(container, issues, people);
    });
  });
}

function milestoneRow(m) {
  const total = m.open_issues + m.closed_issues;
  const pct = total ? Math.round((m.closed_issues / total) * 100) : 0;
  return `
    <div class="list-row" style="display:block;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <a href="${esc(m.html_url)}" target="_blank" rel="noopener">${esc(m.title)}</a>
        <span class="badge" style="background:${m.state === 'open' ? 'var(--accent-soft)' : 'var(--good-soft)'};color:${m.state === 'open' ? 'var(--accent)' : 'var(--good)'};flex:none;">${esc(m.state)}</span>
        <span class="meta" style="margin-left:auto;">${m.due_on ? new Date(m.due_on).toLocaleDateString() : 'no due date'}</span>
      </div>
      <div class="progress-bar"><div style="width:${pct}%;"></div></div>
      <span class="meta">${m.closed_issues}/${total} issues closed</span>
    </div>`;
}

function renderRoadmap(container, milestones) {
  if (!milestones.length) {
    container.innerHTML = `<p class="empty-state">No milestones — create some on GitHub to power the roadmap.</p>`;
    return;
  }
  const open = milestones.filter((m) => m.state === 'open');
  const closed = milestones.filter((m) => m.state === 'closed');
  container.innerHTML = `
    ${open.length ? `<h4 style="font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin:0 0 6px;">Open · ${open.length}</h4>${open.map(milestoneRow).join('')}` : ''}
    ${closed.length ? `<h4 style="font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin:18px 0 6px;">Closed · ${closed.length}</h4>${closed.map(milestoneRow).join('')}` : ''}
  `;
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

export function renderSettings(el, { onPeopleChanged }) {
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
              <input type="text" class="github-username-input" placeholder="github username" value="${esc(p.githubUsername || '')}" title="Their real GitHub username — used for the avatar and to match assigned issues.">
              <div class="swatches">
                ${PALETTE.map((c) => `<span class="swatch ${c === p.color ? 'selected' : ''}" data-color="${c}" style="background:${colorVar(c)}"></span>`).join('')}
              </div>
              <button class="btn btn-ghost btn-small remove-person" title="Remove">✕</button>
            </div>`).join('')}
        </div>
        <div class="field-row">
          <input type="text" id="new-person-name" placeholder="Name">
          <input type="text" id="new-person-github" placeholder="GitHub username">
          <button class="btn btn-primary btn-small" id="add-person-btn">Add</button>
        </div>
        <p class="settings-note">Each person automatically gets their own tab. Add their real GitHub username to pull in their actual avatar and highlight issues assigned to them on GitHub.</p>
      </div>

      <div class="settings-card">
        <h3>Data &amp; GitHub access</h3>
        <p class="settings-note">People &amp; projects are stored in a Cloudflare D1 database — no per-device setup needed. Live Kanban/bugs/roadmap/releases are fetched through the dashboard's own server, which holds one GitHub token centrally — set it once here and it works for everyone, on every device.</p>

        <label style="display:block;font-family:'IBM Plex Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink-soft);margin:14px 0 6px;">Shared GitHub token</label>
        <p class="settings-note" id="github-token-status">Checking…</p>
        <div class="field-row">
          <input type="password" id="github-token-input" placeholder="github_pat_… or ghp_…">
          <button class="btn btn-small" id="save-token-btn">Save</button>
        </div>
        <p class="settings-note">Needs <b>Contents: Read</b> access to every project repo. Stored in the database, never sent to any browser after this. “↻ Sync from GitHub” (Projects tab) lists everything this token can see — owned repos, org repos, and repos you're just a collaborator on. Note: a <b>fine-grained</b> token can only reach repos owned by its own account/org — to pull in a repo you collaborate on under someone else's personal account, use a <b>classic</b> token (repo scope) instead.</p>
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
    const nameInput = el.querySelector('#new-person-name');
    const githubInput = el.querySelector('#new-person-github');
    const name = nameInput.value.trim();
    if (!name) return;
    const usedColors = new Set(people.map((p) => p.color));
    const color = PALETTE.find((c) => !usedColors.has(c)) || PALETTE[people.length % PALETTE.length];
    store.data.people.push({ id: store.nextId('person'), name, githubUsername: githubInput.value.trim().replace(/^@/, ''), color });
    nameInput.value = '';
    githubInput.value = '';
    await onPeopleChanged();
  });

  el.querySelectorAll('.github-username-input').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const id = e.target.closest('.person-row').dataset.id;
      const person = store.getPerson(id);
      person.githubUsername = e.target.value.trim().replace(/^@/, '');
      await onPeopleChanged();
    });
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

  const tokenStatusEl = el.querySelector('#github-token-status');
  getGithubTokenStatus()
    .then(({ isSet, hint }) => { tokenStatusEl.textContent = isSet ? `A token is set (ends in ${hint}).` : 'No token set yet — Kanban/bugs/roadmap/releases and Sync from GitHub won\'t work until one is added.'; })
    .catch(() => { tokenStatusEl.textContent = 'Could not check token status.'; });
  el.querySelector('#save-token-btn').addEventListener('click', async () => {
    const input = el.querySelector('#github-token-input');
    const val = input.value.trim();
    if (!val) return;
    try {
      const { hint } = await setGithubToken(val);
      input.value = '';
      tokenStatusEl.textContent = `A token is set (ends in ${hint}).`;
      alert('GitHub token saved.');
    } catch (e) {
      alert(`Couldn't save token: ${e.message}`);
    }
  });

  el.querySelector('#save-password-btn').addEventListener('click', async () => {
    const input = el.querySelector('#new-password');
    const val = input.value;
    if (!val) return;
    try {
      await updatePassword(val);
      input.value = '';
      alert('Password updated. Everyone will need the new password next time they unlock the dashboard.');
    } catch (e) {
      alert(`Couldn't update password: ${e.message}`);
    }
  });
}
