// github.js — client for live project data (issues, milestones, releases).
// All requests go through our own /api/github proxy (Pages Function), which
// holds the real GitHub token server-side. No GitHub credential is ever
// present in the browser.

import { getToken } from './store.js';

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

async function proxyFetch(parsed, type, state) {
  const params = new URLSearchParams({ repo: `${parsed.owner}/${parsed.repo}`, type });
  if (state) params.set('state', state);
  const res = await fetch(`/api/github?${params.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function fetchIssues(parsed, _token, state = 'all') {
  return proxyFetch(parsed, 'issues', state);
}

export function fetchMilestones(parsed, _token, state = 'open') {
  return proxyFetch(parsed, 'milestones', state);
}

export function fetchReleases(parsed) {
  return proxyFetch(parsed, 'releases');
}

// Every repo the shared token can see: owned, org-member, and repos you're
// just a collaborator on.
export async function fetchAllRepos() {
  const res = await fetch('/api/github?type=repos', {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
