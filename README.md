# Camp Challenge — Project Overview Dashboard

A dashboard for tracking Zul & Marc's projects: a combined timeline, a
projects tab for creating/assigning work (with a "Sync from GitHub" button
to pull in repos automatically), individual boards per person, and live
Kanban / bug tracker / roadmap / product-launch views pulled straight from
each project's GitHub repo.

**Architecture**: a static frontend (plain HTML/CSS/JS, no build step) on
Cloudflare Pages, backed by a few Cloudflare Pages Functions (`functions/`)
and a Cloudflare D1 database. GitHub itself is only ever called **server
side** — the one GitHub token lives in a Cloudflare secret, never in a
browser. People are real GitHub accounts: give each person their GitHub
username in Settings and their real avatar shows up everywhere, and issues
assigned to them on GitHub get flagged on the Kanban board.

## How it fits together

- `index.html` / `css/` / `js/` — the dashboard UI.
- `functions/api/*.js` — small serverless endpoints (Cloudflare Pages
  Functions) that read/write D1 and proxy GitHub's API.
- `schema.sql` — the D1 table definitions (people, projects, assignments,
  and a small key/value `settings` table for the password hash + the
  GitHub org to sync from).
- `wrangler.toml` — binds the D1 database to the Pages Functions.

Nothing about people/projects/password ever needs a GitHub token in the
browser — that only happens for the *content* proxy (`/api/github`), which
runs entirely server-side.

## One-time setup for a fresh deploy

```bash
# 1. Create the D1 database
npx wrangler d1 create cc-intern-dashboard-db
# copy the printed database_id into wrangler.toml's [[d1_databases]] block

# 2. Apply the schema
npx wrangler d1 execute cc-intern-dashboard-db --remote --file=schema.sql

# 3. Create the Pages project (first time only)
npx wrangler pages project create cc-intern-dashboard --production-branch=main

# 4. Set the server-side GitHub token (fine-grained PAT, Contents: Read
#    access to every repo you'll track as a project — read-only is enough,
#    the proxy never writes to GitHub)
npx wrangler pages secret put GITHUB_TOKEN --project-name cc-intern-dashboard

# 5. Deploy
npx wrangler pages deploy . --project-name cc-intern-dashboard
```

For auto-deploy on every `git push`, connect the Pages project to this repo
under Project → Settings → Build → Connect to Git (branch `main`, no build
command, output directory `/`).

## Using it

- First person to open the URL sets the shared password right there on the
  lock screen — whatever they type becomes the password for everyone.
- **Settings → People**: add each person's name and real GitHub username.
- **Settings → GitHub org/username to sync repos from**: the account the
  Projects tab's "↻ Sync from GitHub" button scans.
- **Projects → ↻ Sync from GitHub**: lists repos under that org/account not
  already tracked as a project, and lets you import any of them in one
  click (name/description pulled from GitHub; edit anything afterward).
- To power a project's Kanban/bugs/roadmap, just use real labels (`bug`,
  `todo`, `in progress`) and milestones/releases on its GitHub repo — the
  dashboard reads them live, nothing to configure beyond the repo URL.

## How data flows

- **People & projects** — stored in D1 (`people`, `projects`,
  `project_assignees` tables), read/written through `/api/state`.
- **Password** — a sha256 hash lives in D1's `settings` table, never sent to
  the browser; `/api/login` checks it server-side and returns a bearer token
  used for subsequent requests. This is a convenience lock, not real
  security — don't put anything sensitive behind it.
- **Kanban** — derived from a project repo's open/closed issues via
  `/api/github`, grouped by the labels `todo`, `in progress` /
  `in-progress` (anything else open is "Backlog"; closed issues are
  "Done"). Cards show the real GitHub avatar(s) of whoever the issue is
  assigned to.
- **Bug tracker** — issues labeled `bug`.
- **Roadmap** — open milestones, with a progress bar from closed/open issue counts.
- **Product launch** — GitHub Releases.

## Local development

```bash
npx wrangler d1 execute cc-intern-dashboard-db --local --file=schema.sql
npx wrangler pages dev .
```

(`wrangler pages dev` reads the D1 binding from `wrangler.toml` automatically.)
