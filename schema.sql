-- Camp Challenge dashboard schema (Cloudflare D1)

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  github_username  TEXT DEFAULT '',
  color            TEXT DEFAULT 'p1',
  sort_order       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  repo_url     TEXT DEFAULT '',
  category     TEXT DEFAULT '',
  status       TEXT DEFAULT 'planning',
  start_date   TEXT DEFAULT '',
  end_date     TEXT DEFAULT '',
  sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_assignees (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, person_id)
);

-- seed the two people from the original prototype; safe to edit/remove later from Settings
INSERT OR IGNORE INTO people (id, name, github_username, color, sort_order) VALUES
  ('zul',  'Zul',  '', 'p1', 0),
  ('marc', 'Marc', '', 'p2', 1);
