# Camp Challenge — Project Overview Dashboard

A static dashboard for tracking Zul & Marc's projects: a combined timeline, a
projects tab for creating/assigning work, individual boards per person, and
live Kanban / bug tracker / roadmap / product-launch views pulled straight
from each project's GitHub repo.

No backend, no build step — it's plain HTML/CSS/JS, so it deploys to
Cloudflare Pages as-is. **GitHub is the database**: people and projects are
stored as a JSON file in a repo you choose, edited through the GitHub API.

## 1. Create a data repo

Create a small (can be private) GitHub repo to hold the dashboard's data,
e.g. `camp-challenge-dashboard-data`. You don't need to put anything in it —
the app will create `dashboard-data.json` the first time you connect.

## 2. Create a GitHub token

Each person who wants to **create/edit projects or people** needs a token
(read-only viewing of public project repos works without one, but writes to
the data repo need it):

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Resource owner: yourself (or your org). Repository access: **Only** the data repo you made in step 1.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. Generate, copy the token (starts with `github_pat_...`).

The token is only ever stored in that browser's `localStorage` — it is never
committed anywhere or sent to any server besides `api.github.com`.

## 3. Run it locally

Any static file server works, e.g.:

```bash
npx serve .
```

Open it, and the **Connect your data repo** screen appears — fill in the
owner/repo/path/branch from step 1 and paste your token.

The first person to connect will be asked to set a shared password in
Settings afterwards (skip the lock screen until you set one).

## 4. Deploy to Cloudflare Pages

**Option A — dashboard (no CLI):**
1. Go to the Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets.
2. Upload this whole folder (`index.html`, `css/`, `js/`, `assets/`).
3. Deploy. Share the resulting `*.pages.dev` URL with Marc.

**Option B — Wrangler CLI:**
```bash
npm install -g wrangler
wrangler pages deploy . --project-name camp-challenge-dashboard
```

Every teammate opens the URL, connects once with their own token (step 3),
and unlocks with the shared password.

## How data flows

- **People & projects** — stored in `dashboard-data.json` in your data repo.
  Every create/edit/delete in the UI commits straight to that file via the
  GitHub Contents API.
- **Kanban** — derived from each project repo's open/closed issues, grouped
  by the labels `todo`, `in progress` / `in-progress` (anything else open is
  "Backlog"; closed issues are "Done").
- **Bug tracker** — issues labeled `bug`.
- **Roadmap** — open milestones, with a progress bar from closed/open issue counts.
- **Product launch** — GitHub Releases.

To power Kanban/bugs/roadmap for a project, just give it real labels (`bug`,
`todo`, `in progress`) and milestones/releases on GitHub — the dashboard
reads them live, nothing to configure per-project beyond the repo URL.

## Security notes

- The password gate is a convenience lock, not real security — the hash is
  stored in the (likely private) data repo and checked client-side. Don't
  put anything sensitive behind it.
- Give the data-repo token the *minimum* scope (Contents: Read & write on
  that one repo) as described above.
