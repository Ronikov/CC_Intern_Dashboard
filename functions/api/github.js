// GET /api/github?repo=owner/name&type=issues|milestones|releases&state=open|closed|all
// GET /api/github?type=repos
//   Lists every repo the token can see: owned, org-member, and repos you're
//   just a collaborator on. Note: a fine-grained PAT can only reach repos
//   owned by its own "resource owner" account/org — to see a repo you
//   collaborate on under someone else's personal account, the token needs
//   to be a classic PAT (repo scope) instead.
// Proxies GitHub's REST API using a server-side token (set from Settings,
// stored in D1 — see /api/github-token — or a GITHUB_TOKEN Wrangler secret
// as a fallback), so no GitHub credential ever needs to reach a browser.
// Requires our own dashboard auth (Authorization: Bearer <token> from
// /api/login).

import { requireAuth, getGithubToken, json } from '../_auth.js';

const ALLOWED_TYPES = new Set(['issues', 'milestones', 'releases', 'repos']);

function ghHeaders(ghToken) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${ghToken}`,
    'User-Agent': 'cc-intern-dashboard',
  };
}

export async function onRequestGet({ request, env }) {
  const token = await requireAuth(request, env);
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';
  if (!ALLOWED_TYPES.has(type)) return json({ error: 'Invalid type' }, { status: 400 });

  const ghToken = await getGithubToken(env);
  if (!ghToken) return json({ error: 'No GitHub token configured yet — add one in Settings.' }, { status: 500 });

  if (type === 'repos') {
    // Paginate through everything the token can see (owned + org + collaborator).
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const ghRes = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&visibility=all&affiliation=owner,collaborator,organization_member`,
        { headers: ghHeaders(ghToken) }
      );
      const batch = await ghRes.json().catch(() => null);
      if (!ghRes.ok) return json({ error: batch?.message || `GitHub API error (${ghRes.status})` }, { status: ghRes.status });
      all.push(...(batch || []));
      if (!batch || batch.length < 100) break; // last page
    }

    const repos = all.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      htmlUrl: r.html_url,
      description: r.description || '',
      updatedAt: r.updated_at,
      private: r.private,
      archived: r.archived,
    }));
    return json(repos);
  }

  const repo = url.searchParams.get('repo') || '';
  const state = url.searchParams.get('state') || 'all';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return json({ error: 'Invalid repo' }, { status: 400 });

  let path;
  if (type === 'issues') path = `issues?state=${encodeURIComponent(state)}&per_page=100`;
  if (type === 'milestones') path = `milestones?state=${encodeURIComponent(state)}&per_page=100&sort=due_on&direction=asc`;
  if (type === 'releases') path = `releases?per_page=20`;

  const ghRes = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: ghHeaders(ghToken) });
  const data = await ghRes.json().catch(() => null);
  if (!ghRes.ok) {
    return json({ error: data?.message || `GitHub API error (${ghRes.status})` }, { status: ghRes.status });
  }

  const result = type === 'issues' ? (data || []).filter((i) => !i.pull_request) : data;
  return json(result);
}
