# Camp Challenge — Project Overview Dashboard

A static dashboard for tracking Zul & Marc's projects: a combined timeline, a
projects tab for creating/assigning work, individual boards per person, and
live Kanban / bug tracker / roadmap / product-launch views pulled straight
from each project's GitHub repo.

No backend, no build step — it's plain HTML/CSS/JS, so it deploys to
Cloudflare Pages as-is. **GitHub is the database**: people and projects are
stored as a JSON file in a repo, edited through the GitHub API. **People are
real GitHub accounts** — give each person their GitHub username in Settings
and their real avatar shows up everywhere, and issues assigned to them on
GitHub get flagged on the Kanban board.

## 1. Where the data lives

You can reuse this same repo (`CC_Intern_Dashboard`) to hold the data file —
no need to create a second one. The app will create `dashboard-data.json` in
it the first time someone connects.

## 2. Create the one shared GitHub token

The whole team uses **one token**, generated once by whoever administers the
GitHub org/account. It needs access to *every* repo that's tracked as a
project (not just the data repo), since it's also used to read each
project's issues/milestones/releases for the Kanban, bug tracker, roadmap,
and product-launch views.

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Resource owner: your account or org.
3. Repository access: **All repositories** (simplest — new projects just work), or "Only select repositories" and add each project repo + the data repo as you create them.
4. Permissions → Repository permissions → **Contents: Read and write** (write is only strictly needed on the data repo, but "all repos" access is easiest to manage as one grant).
5. Generate, copy the token (starts with `github_pat_...`).
6. Share this one token with Marc (and anyone else) out of band — e.g. a password manager — so everyone pastes the *same* token when they connect their device.

The token is only ever stored in each browser's `localStorage` — it is never
committed anywhere or sent to any server besides `api.github.com`.

## 3. Adding people

In **Settings → People**, add each person's name and their **real GitHub
username**. That unlocks:
- their actual GitHub avatar throughout the dashboard (falls back to colored initials if left blank or the image fails to load)
- a small avatar badge on Kanban cards showing who a GitHub issue is actually assigned to

## 4. Run it locally

Any static file server works, e.g.:

```bash
npx serve .
```

Open it, and the **Connect your data repo** screen appears — fill in the
owner/repo/path/branch from step 1 and paste the shared token.

The first person to connect will be asked to set a shared password in
Settings afterwards (skip the lock screen until you set one).

## 5. Deploy to Cloudflare Pages

**Option A — dashboard (no CLI):**
1. Go to the Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets.
2. Upload this whole folder (`index.html`, `css/`, `js/`, `assets/`).
3. Deploy. Share the resulting `*.pages.dev` URL with Marc.

**Option B — Wrangler CLI:**
```bash
npx wrangler pages deploy . --project-name cc-intern-dashboard
```

**Option C — auto-deploy on push:** connect the Cloudflare Pages project to
this GitHub repo (Project → Settings → Build → Connect to Git → pick
`Ronikov/CC_Intern_Dashboard`, branch `main`, no build command, output
directory `/`). Every `git push` then deploys automatically.

Every teammate opens the URL, connects once with the shared token (step 4),
and unlocks with the shared password.

## How data flows

- **People & projects** — stored in `dashboard-data.json`. Every
  create/edit/delete in the UI commits straight to that file via the GitHub
  Contents API.
- **Kanban** — derived from each project repo's open/closed issues, grouped
  by the labels `todo`, `in progress` / `in-progress` (anything else open is
  "Backlog"; closed issues are "Done"). Cards show the real GitHub avatar(s)
  of whoever the issue is assigned to.
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
- Because one token now has broad access across every project repo, treat it
  like a shared secret: don't paste it anywhere but the Settings/setup
  screen, and rotate it if a device with it is lost.
