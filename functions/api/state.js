// GET  /api/state  -> { people, projects }
// PUT  /api/state  <- { people, projects }   (full replace, small dataset so this is simplest & safest)
// Both require Authorization: Bearer <token> from /api/login.

import { requireAuth, json } from '../_auth.js';

export async function onRequestGet({ request, env }) {
  const token = await requireAuth(request, env);
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = env.DB;
  const [peopleRows, projectRows, assigneeRows] = await Promise.all([
    db.prepare('SELECT id, name, github_username, color FROM people ORDER BY sort_order').all(),
    db.prepare('SELECT id, name, description, repo_url, category, status, start_date, end_date FROM projects ORDER BY sort_order').all(),
    db.prepare('SELECT project_id, person_id FROM project_assignees').all(),
  ]);

  const assigneesByProject = {};
  for (const row of assigneeRows.results) {
    (assigneesByProject[row.project_id] ||= []).push(row.person_id);
  }

  const people = peopleRows.results.map((p) => ({
    id: p.id,
    name: p.name,
    githubUsername: p.github_username || '',
    color: p.color,
  }));

  const projects = projectRows.results.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    repoUrl: p.repo_url || '',
    category: p.category || '',
    status: p.status || 'planning',
    start: p.start_date || '',
    end: p.end_date || '',
    assignees: assigneesByProject[p.id] || [],
  }));

  return json({ people, projects });
}

export async function onRequestPut({ request, env }) {
  const token = await requireAuth(request, env);
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.people) || !Array.isArray(body.projects)) {
    return json({ error: 'Invalid body: expected { people: [], projects: [] }' }, { status: 400 });
  }

  const db = env.DB;
  const stmts = [
    db.prepare('DELETE FROM project_assignees'),
    db.prepare('DELETE FROM projects'),
    db.prepare('DELETE FROM people'),
  ];

  body.people.forEach((p, i) => {
    stmts.push(
      db.prepare('INSERT INTO people (id, name, github_username, color, sort_order) VALUES (?, ?, ?, ?, ?)')
        .bind(p.id, p.name, p.githubUsername || '', p.color || 'p1', i)
    );
  });

  body.projects.forEach((p, i) => {
    stmts.push(
      db.prepare(
        'INSERT INTO projects (id, name, description, repo_url, category, status, start_date, end_date, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(p.id, p.name, p.description || '', p.repoUrl || '', p.category || '', p.status || 'planning', p.start || '', p.end || '', i)
    );
    (p.assignees || []).forEach((personId) => {
      stmts.push(db.prepare('INSERT INTO project_assignees (project_id, person_id) VALUES (?, ?)').bind(p.id, personId));
    });
  });

  await db.batch(stmts);
  return json({ ok: true });
}
