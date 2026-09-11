// github.js — thin wrapper around the GitHub REST API.
// Used for two things:
//  1) reading/writing the dashboard's own data file (people/projects), via the
//     connection configured in Settings (owner/repo/path/branch/token).
//  2) reading live project data (issues, milestones, releases) from whatever
//     repo a project's "repoUrl" field points to.

const API = 'https://api.github.com';

function authHeaders(token) {
  const h = { 'Accept': 'application/vnd.github+json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function ghFetch(url, token, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authHeaders(token), ...(opts.headers || {}) } });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message; } catch { /* ignore */ }
    const err = new Error(`GitHub API ${res.status}: ${detail || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/* ---------------- dashboard data file (contents API) ---------------- */

export async function fetchDataFile({ owner, repo, path, branch, token }) {
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch || 'main')}`;
  try {
    const res = await ghFetch(url, token);
    const json = await res.json();
    const content = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
    return { sha: json.sha, data: JSON.parse(content) };
  } catch (e) {
    if (e.status === 404) return { sha: null, data: null };
    throw e;
  }
}

export async function saveDataFile({ owner, repo, path, branch, token }, data, sha, message) {
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || 'Update dashboard data',
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    branch: branch || 'main',
  };
  if (sha) body.sha = sha;
  const res = await ghFetch(url, token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  return json.content.sha;
}

/* ---------------- parsing a project's repo URL ---------------- */

export function parseRepoUrl(repoUrl) {
  if (!repoUrl) return null;
  try {
    const cleaned = repoUrl.trim().replace(/\.git$/, '').replace(/\/$/, '');
    const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  } catch {
    return null;
  }
}

/* ---------------- live project data ---------------- */

export async function fetchIssues({ owner, repo }, token, state = 'all') {
  const url = `${API}/repos/${owner}/${repo}/issues?state=${state}&per_page=100`;
  const res = await ghFetch(url, token);
  const all = await res.json();
  // exclude PRs
  return all.filter((i) => !i.pull_request);
}

export async function fetchMilestones({ owner, repo }, token, state = 'open') {
  const url = `${API}/repos/${owner}/${repo}/milestones?state=${state}&per_page=100&sort=due_on&direction=asc`;
  const res = await ghFetch(url, token);
  return res.json();
}

export async function fetchReleases({ owner, repo }, token) {
  const url = `${API}/repos/${owner}/${repo}/releases?per_page=20`;
  const res = await ghFetch(url, token);
  return res.json();
}

export async function fetchRepoMeta({ owner, repo }, token) {
  const url = `${API}/repos/${owner}/${repo}`;
  const res = await ghFetch(url, token);
  return res.json();
}
