# Sign-in and encrypted data: setup

The platform now has real accounts (email + password) and the synced Streamtime data is
encrypted on the public `streamtime-data` branch. This is a testing-scale setup; the backend is
expected to be rebuilt by another agency later.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| `middleware.js` | Vercel Routing Middleware | Every request needs a signed session cookie, except `/login.html` and `/api/auth/{login,logout,status,request,password}`. Pages redirect to `/login.html`; API calls get `401`. A session with a pending password change only reaches those public paths. |
| `api/auth/[action].js` | `/api/auth/*` | Sign in, sign out, status, "Request access", change password. |
| `api/me.js` | `/api/me` | `{email, name, personKey, admin, perms}` for the signed-in person. |
| `api/access.js` | `/api/access` | Needs the **User permissions** permission: list, add, reset password, link person, set permissions (`setPerms`), remove, approve, decline. |
| `api/data/[file].js` | `/api/data/<file>.json` | Fetches `<file>.json.enc` from the public branch, decrypts it with `DATA_KEY`, returns it **still gzipped** (`Content-Encoding: gzip`). Each warm instance caches files for about 60 seconds; a GitHub `429` becomes `503` with `Retry-After`. |
| `api/boards.js` | `/api/boards` | Shared boards (one encrypted file each on the `app-state` branch). `?removed=1` and `{action:'restore'}` are for admins. |
| `scripts/data_crypt.py` + `scripts/sync_loop.sh` | GitHub Actions | The sync writes `<name>.json.enc` next to each file it owns, and (later) stops writing the readable copies. |
| `login.html` | `/login.html` | Sign-in, request-access and forced change-password forms. |
| Settings → **Access** | `index.html` | The UI for the list above, with a **Permissions** panel per person. |

**Accounts** live in `auth/access.json.enc` on the repo's **`app-state` branch** (the state
store, written through the GitHub API with `GITHUB_STATE_TOKEN`; see "State store on GitHub"
below), encrypted with `STORE_KEY` (AES-256-GCM). Shared boards (`boards/`) and check-ins
(`happiness/`) live in the same store, with the same key. While `STORE_KEY` is unset, the store uses `DATA_KEY`, so nothing breaks before you set it. Passwords are hashed with scrypt (`scrypt$N$r$p$salt$hash`).
Admins never see or choose other people's passwords, and nobody chooses their own before an
admin lets them in. Adding someone, approving a request or resetting a password creates a
one-time temporary password, which is shown once to the admin. The person must change it at
first sign-in.

**Permissions** (`lib/perms.js`, like Streamtime's: Essentials, Plan & Manage, Admin, Finances) are set per person in Settings → Access → Permissions. Records without stored permissions get them on read: admin → everything, otherwise Essentials. "Admin" now means having **User permissions**. `ADMIN_EMAILS` owners always have every permission and can't be reduced; somebody must always keep User permissions. Invoices, quotes, expenses and rate cards need View financials; other data files are served with money fields cut without View financials, and cost rates cut without Team cost rates. Tests: `node scripts/test_perms.mjs`.
Being in `ADMIN_EMAILS` does not create an account. The first admin account is made once, with
the setup code (`BOOTSTRAP_TOKEN`, step 4).

**Sessions** are HMAC-SHA256-signed cookies (`__Host-cc_session`, HttpOnly, Secure,
SameSite=Lax, 14 days). Every API call also re-checks the account list, so these take effect
within about 30 seconds: removing someone, resetting their password, or changing their own
password (which signs out their other sessions).

**Encrypted file format:** `CCE1` + 12-byte random nonce + AES-256-GCM(gzip(json)) + tag.

## What the owner runs (in this order)

All commands are run from a checkout of the repo, with `gh` and `vercel` logged in and the
directory linked to the Vercel project (`vercel link`).

### 1. Make the keys

```bash
openssl rand -hex 32   # → DATA_KEY        (64 hex chars; the same value goes to GitHub AND Vercel)
openssl rand -hex 32   # → STORE_KEY       (64 hex chars; Vercel only: accounts and boards)
openssl rand -hex 32   # → SESSION_SECRET  (Vercel only)
openssl rand -hex 24   # → BOOTSTRAP_TOKEN (Vercel only; the one-time setup code for the first admin)
```

Keep `DATA_KEY` and `STORE_KEY` somewhere safe, such as a password manager. Without them the
encrypted data can't be read.

**Keys can't be rotated in place.** Everything is encrypted with the key that was set when it
was written, and nothing re-encrypts it for you:

- **`DATA_KEY`** (synced data): changing it on Vercel alone breaks `/api/data` until the branch
  is re-published with the new key. Changing it on GitHub alone makes the next sync run **fail**
  (it can't decrypt the previous run's `.enc` files), on purpose, so it never starts from empty
  data. To change it: decrypt the branch's `.enc` files with the old key
  (`scripts/data_crypt.py decrypt`), encrypt them with the new one (`encrypt`), push them to
  `streamtime-data`, then set the new key on GitHub and Vercel together.
- **`STORE_KEY`** (accounts and boards): changing it makes every `/api` call return
  `500 {"error":"Store key mismatch"}` (logged once per instance) until the old key is put back.
  Nothing is overwritten while that's happening. To really change it, download and decrypt
  `auth/access.json.enc` and `boards/*.json.enc` with the old key (`scripts/data_crypt.py decrypt`
  with `DATA_KEY=<old key>`), re-encrypt them with the new one, upload them, then switch the env var.
- If you already run with `DATA_KEY` only, setting `STORE_KEY` for the first time is a key change
  for the store: either keep `STORE_KEY` unset (the store keeps using `DATA_KEY`), or set
  `STORE_KEY` before the first account is created.

### 2. Turn on encryption in the sync (GitHub)

```bash
gh secret set DATA_KEY --repo ronanheal/CandCPlatform          # paste the value when asked
gh variable set PUBLISH_PLAINTEXT --body true --repo ronanheal/CandCPlatform
```

The next sync cycle (at most 15 minutes, or run **Actions → Streamtime Sync → Run workflow**)
publishes `*.json.enc` next to the existing plaintext files. To check:

```bash
curl -sI https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data/jobs.json.enc | head -1   # 200
```

`DATA_KEY` unset means the sync behaves exactly as before. The workflow installs the
`cryptography` package itself.

### 3. Vercel: state store token and environment variables

The server-side state (accounts, shared boards, check-ins) is stored on the `app-state` branch
of this repo (see **State store on GitHub** below). Create the token first (3a), then add the
variables.

```bash
# Secrets (each command asks for the value; add to Production, and Preview if you use previews):
vercel env add GITHUB_STATE_TOKEN production   # the fine-grained token from 3a
vercel env add SESSION_SECRET production
vercel env add DATA_KEY production
vercel env add STORE_KEY production        # optional; unset → the store uses DATA_KEY
vercel env add ADMIN_EMAILS production      # e.g. you@example.com  (comma-separated for several)
vercel env add BOOTSTRAP_TOKEN production   # the setup code from step 1 (16+ characters)
```

| Variable | Needed | When unset |
|---|---|---|
| `SESSION_SECRET` | yes | Nobody gets past the sign-in page (fails closed). |
| `DATA_KEY` | yes | `/api/data` returns `503`. |
| `GITHUB_STATE_TOKEN` | yes | Every `/api` call that needs the account list returns `503` ("Data store is not configured"): nobody can sign in. |
| `STATE_REPO` | no | `ronanheal/CandCPlatform`. |
| `STATE_BRANCH` | no | `app-state`. |
| `STORE_KEY` | recommended | The state store (accounts, boards, check-ins) uses `DATA_KEY`. |
| `ADMIN_EMAILS` | yes | No owners; only people given admin in the Access card are admins. |
| `BOOTSTRAP_TOKEN` | for the first sign-in | The first-admin bootstrap is off: `ADMIN_EMAILS` people just make a normal request. Shorter than 16 characters also counts as off. |

Then redeploy so the new env vars apply: `vercel --prod`, or push or merge to `main`.

#### 3a. Create the state token (owner, on github.com)

1. github.com → your avatar → **Settings** → **Developer settings** → **Personal access tokens**
   → **Fine-grained tokens** → **Generate new token**.
2. **Token name:** `cc-platform state store`. **Resource owner:** `ronanheal`.
   **Expiration:** 90 days (or a custom date up to a year; put a reminder in your calendar a
   week before — when it expires nobody can sign in until a new one is set).
3. **Repository access:** **Only select repositories** → `ronanheal/CandCPlatform`. Nothing else.
4. **Permissions → Repository permissions → Contents: Read and write.** Leave everything else at
   *No access* (Metadata: Read-only is added automatically and is required).
5. **Generate token**, copy it once, then:

   ```bash
   vercel env add GITHUB_STATE_TOKEN production   # paste the token
   vercel --prod                                   # redeploy so it applies
   ```

To renew: generate a new token the same way, `vercel env rm GITHUB_STATE_TOKEN production`,
add the new one, redeploy, then delete the old token on GitHub.

### State store on GitHub (since 2026-11)

The account list, shared boards and check-ins used to live in a private Vercel Blob store. Blob's
free tier allows 2,000 advanced operations (put/list/copy) a month; when they ran out Vercel
paused the store and nobody could sign in. They now live on the **`app-state`** branch of this
repo, written by the functions through the GitHub REST contents API (`lib/ghstore.js`):

| File | What |
|---|---|
| `auth/access.json.enc` | the account list |
| `boards/<id>.json.enc` | one shared board each |
| `boards/index.json` | the board ids (plain text, ids only), so listing boards is one read |
| `happiness/<year>.json.enc` | the weekly check-ins |

- Same encryption and key as before (`STORE_KEY`, CCE1), byte for byte: a file copied from Blob
  decrypts unchanged.
- **The repo is public, so this branch is public too.** Every file is encrypted, but every save is
  a commit, so all past versions stay in the branch history. If `STORE_KEY` ever leaks, treat
  the whole history as exposed (rotate the key, re-encrypt, and rewrite or delete the branch).
- The branch is created automatically from `main`'s HEAD on the first write if it doesn't exist.
- **It must not deploy:** `vercel.json` has `"git": {"deploymentEnabled": {"app-state": false}}`.
  Check once in Vercel → Project → Deployments that no `app-state` deployments appear after a save.
  No GitHub Actions workflow runs on it (`generate-meta.yml` only runs on `main`).
- Budget: one token has 5,000 GitHub API requests an hour, and GitHub also limits writes
  (commits) to about 80 a minute and 500 an hour. A rate-limited call becomes `503` with
  `Retry-After`. The page pulls boards at most once a minute and only while Boards is open,
  waits 2.5 s after the last edit before saving, and stops retrying a failed save after 5 tries.

#### Bringing the old data back (or starting fresh)

Pick one:

- **Fresh admin now (fastest way back in):** make sure `BOOTSTRAP_TOKEN` is set
  (`vercel env add BOOTSTRAP_TOKEN production` with a new `openssl rand -hex 24` value if you
  removed it, then `vercel --prod`), and follow step 4 (`/login.html?setup=1`). The empty store
  works straight away; everyone else then needs to be added again or request access. Boards and
  check-ins stay empty until the migration below.
- **Migrate the old Blob data** once the Blob store is readable again (new billing month, or
  after upgrading the plan). It copies the encrypted files byte for byte and needs no keys:

  ```bash
  vercel env pull .env.blob --environment production     # gets BLOB_READ_WRITE_TOKEN
  export BLOB_READ_WRITE_TOKEN=$(grep ^BLOB_READ_WRITE_TOKEN .env.blob | cut -d= -f2- | tr -d '"')
  export GITHUB_STATE_TOKEN=...                           # the token from 3a
  node scripts/migrate_blob_to_github.mjs --dry-run       # shows what it would copy
  node scripts/migrate_blob_to_github.mjs                 # copies, and writes boards/index.json
  rm .env.blob
  ```

  If you already bootstrapped a fresh admin, the old `auth/access.json.enc` is **skipped** (the
  script reports it) so the new list isn't thrown away. Add `--overwrite` to replace it with the
  old one (the fresh admin then disappears; your old account comes back). Boards and check-ins
  are copied either way. The migration uses one Blob list call plus one read per file.

  Afterwards the Blob store can be disconnected from the project; nothing reads it any more.

> Deploying this code to `main` before step 3 locks everyone out, because the middleware fails
> closed without `SESSION_SECRET`, and the data proxy needs `DATA_KEY` and the `.enc` files.
> Do steps 1–3 first, then merge.

### 4. Create the first admin account (you)

1. Open https://cand-c-platform.vercel.app/login.html?setup=1. The request form shows an extra
   **Setup code** field (only with `?setup=1`).
2. Enter your full name, the email you put in `ADMIN_EMAILS`, and the `BOOTSTRAP_TOKEN` value as
   the setup code.
3. The account is created as an admin and a temporary password is shown **once**. Sign in with
   it and choose your own password.

Without the right code, an `ADMIN_EMAILS` address is treated like anyone else: a request that
waits for an admin. Once any admin account exists the setup code is ignored entirely, so it is
single-use in effect. You can then remove `BOOTSTRAP_TOKEN` from Vercel (recommended).

### 5. Cut-over check

Signed in on the live site:

- The dashboard, jobs, time, invoices and quotes load.
- DevTools → Network: requests go to `/api/data/*.json` and return `200` with
  `content-encoding: gzip`. Nothing loads from `raw.githubusercontent.com`.
- In a private window, `https://cand-c-platform.vercel.app/api/data/jobs.json` returns `401`,
  and `/` redirects to `/login.html`.
- Settings → Team → Access lists you as Owner. Add a test person, sign in as them with the
  temporary password, and confirm you are made to choose a new one.

### 6. Stop publishing plaintext

```bash
gh variable set PUBLISH_PLAINTEXT --body false --repo ronanheal/CandCPlatform
```

Wait for the next publish (up to 15 minutes, or trigger the workflow). Then confirm:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data/jobs.json           # 404
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data/logged_times.json   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data/jobs.json.enc       # 200
```

raw.githubusercontent.com caches for about 5 minutes, so a `200` right after the publish can be
stale.

The sync force-replaces the branch with a single parentless commit on every publish, so no
plaintext stays in the branch's history. Older commits can still be fetched by SHA for a while
until GitHub garbage-collects them, and any existing clone or fork still holds them. Treat the
data as having been public until now.

These stay plaintext on purpose and are proxied as-is: `platform_config.json`,
`changelog.json`, `platform_meta.json` and `roadmap.json`. They are written by the browser's
"Publish config" button and by `generate-meta.yml`, and hold team names and settings rather
than client financials. `vercel.json` also stays.

## Day to day

- **Add someone:** Settings → Team → Access → Add a person: their email, which Streamtime person
  they are, and whether they are an admin. Copy the temporary password shown and send it to them
  privately. It is not shown again.
- **Someone forgot their password:** use the key icon on their row (Reset password) and send them
  the new temporary password.
- **Requests:** people in Streamtime can use **Request access** on the sign-in page with their
  full name (or Streamtime email). They don't choose a password. Requests appear under "Waiting
  for approval", marked **email not verified**: anyone can type any email. **Approve** creates
  the account and shows a temporary password once. Send it **to that email address** (that is
  what proves the requester owns it), not to whoever asked in chat. **Decline** deletes the
  request. At most 50 requests wait at once; a new one pushes out the oldest.
- **Boards:** a shared board can be deleted by the person who created it or by an admin.
  Admins see **Recently removed** at the bottom of Boards and can restore a board from there.
  Boards shared before this rule existed have no recorded creator, so only admins can delete them.
- **Change your own password:** avatar (bottom left) → Change password.
- **View as someone else** (admins, for support): avatar → View as someone else. You stay signed
  in as yourself. Use **Back to me** to return.

## Local testing

- `python3 -m http.server` on `localhost` / `127.0.0.1` still works with no sign-in, the old
  "who am I" picker and the plaintext raw URLs, **as long as the plaintext files are still
  published**.
- After step 6, the plaintext is gone, so use `vercel dev` with the env vars pulled
  (`vercel env pull .env.local`). That runs the middleware, sign-in and `/api/data`, which needs
  `DATA_KEY`. On localhost the app still defaults to the raw URLs and the local picker, so turn
  the API path on: open `http://localhost:3000/?api=1`, or once per browser run
  `localStorage.setItem('cc_use_api','1')` in the console (remove it to go back). With either,
  the app reads `/api/data`, uses the signed-in identity and shares boards, exactly like the live
  site.
- Tests: `node scripts/test_auth.mjs` (add `PYTHON=/path/to/python` for the Python interop
  check), `node scripts/test_boards.mjs`, `node scripts/test_onboard.mjs`,
  `node scripts/test_ghstore.mjs` (state store and migration), and `bash scripts/test_sync_crypt.sh` (needs a
  `python3` with `cryptography`, or `PYTHON=/path/to/venv/bin/python`).

## What gets deployed

`.vercelignore` keeps `scripts/`, `docs/`, `private/`, `.github/`, `.claude/`, Markdown files and
tests out of the deployment. The site is `index.html`, `login.html`, `middleware.js`, `lib/`,
`api/`, `package.json`, `package-lock.json` and `vercel.json`.

## Still per-browser (note for testers)

Signing in does not move these into a shared store. They stay in each browser's localStorage:

- To Do board edits and manual tasks
- Boards
- Platform-native records: quotes created in the platform, local jobs, notes, archived/deleted
  flags
- Personal preferences: theme, wallpaper, dashboard teams/hide, running timer

Shared across everyone: the Streamtime data, the published team config ("Publish config", still
via a GitHub token in the browser, unchanged), and the account list.

## Limits worth knowing

- No Content-Security-Policy header: the app is one file with inline scripts and inline event
  handlers, so a useful CSP (no `unsafe-inline`) would break it. XSS is handled by escaping in
  the page and by the server's whitelist of board fields (`lib/boards.js` `cleanBoard`).
- The sync fails its GitHub Actions run (red, with an `::error::` annotation) when the encrypted
  data can't be decrypted, instead of skipping cycles quietly. A plain fetch failure is still
  retried next cycle.
- Login throttling (5 failures per email → 5-minute lock; per-IP limits on sign-in and on
  requests) is in-memory per serverless instance. That's fine for a team, but it is not a
  defence against a distributed attack.
- The readable `cc_who` cookie, which holds email, name, person and admin, only drives the UI.
  Editing it changes nothing on the server. A non-admin who edits it could at most see another
  person's dashboard built from data they can already read.
- `ADMIN_EMAILS` people are always admin and can't be removed from the UI. Change the env var
  to change that.
- `scripts/reconcile_streamtime.py` reads plaintext files from the branch with `git show`. After
  step 6 it needs the files decrypted first (`data_crypt.py decrypt`).

## Limits and monitoring

In 2026-11 Vercel Blob's free tier ran out, Vercel paused the store and the whole site went down
with no warning. Every outside limit the site depends on is listed here, with what we expect to
use and where you would hear about it first. Figures checked on 2026-11-17. Vercel's come from
vercel.com/docs/plans/hobby and GitHub's from docs.github.com ("Rate limits for the REST API").

| Limit | Allowance | Expected use | What happens at the limit | Where the alert shows |
|---|---|---|---|---|
| GitHub REST API, `GITHUB_STATE_TOKEN` | 5,000 requests an hour per token (the window resets hourly) | Tens to a few hundred an hour. Reads are cached 30 s per instance and concurrent reads share one request. | `/api` answers `503` with `Retry-After`. Sign-in and saves fail until the hour resets. | Settings → About → **Service health** (meter). A Dashboard banner for admins below 25% left (warn) or 10% left (alert), or after any rate-limited answer in the last hour (alert). |
| GitHub secondary limits (same token) | At most 80 content-creating requests (commits) a minute and 500 an hour; 900 REST points a minute; 100 concurrent requests | Each save is one commit. About 150 commits in the week of 2026-11-17, including main's commits from when the branch was cut, so roughly 20 a day. Boards wait 2.5 s after the last edit before saving. | `403`/`429` "secondary rate limit", turned into `503` with a 60 s `Retry-After`. | Same card and banner (alert for an hour). Weekly workflow fails above **3,000 commits in 7 days**. The card warns above **2,000**. |
| State file size on `app-state` | The contents API returns files up to 1 MB inline. Larger files need a second (blob) call, up to 100 MB. | About 27 KB in total. The largest board is about 10 KB. | Above 1 MB every read costs two requests and gets slower. | Weekly workflow fails if any file under `auth/`, `boards/` or `happiness/` is over **900 KB**. |
| `GITHUB_STATE_TOKEN` expiry | Set to no expiry when it was created (Nov 2026) | Not applicable | If the token is ever deleted or revoked, **nobody can sign in** (every `/api` call returns `503`) until a new one is set. | Nothing to track. If you make a new token, choose "No expiration". Renewal steps are in 3a. |
| Vercel Hobby: function invocations | First 1,000,000 a month | Roughly 5,000 to 15,000 a day for a team of about 15: every `/api` call, plus the middleware on each request. That is about 150k to 450k a month. | Hobby has no overage. In most cases the feature pauses until 30 days have passed, which takes the site down. | Not watched by the workflow, which never touches Vercel. Check Vercel → Usage once a month. The weekly workflow still fails within a week if the site stops answering. |
| Vercel Hobby: Active CPU, provisioned memory | 4 CPU-hours and 360 GB-hours a month | Small: functions mostly wait on GitHub, and Active CPU counts only compute time. | Same as above. | Vercel → Usage |
| Vercel Hobby: Fast Data Transfer, Fast Origin Transfer, CDN requests | 100 GB transfer, 10 GB origin transfer, 1,000,000 CDN requests a month | `index.html` is about 1.9 MB raw (much less gzipped) per uncached load. `/api/data` files are served gzipped. Expect a few GB a month. | Same as above. | Vercel → Usage. Weekly check of `/api/auth/status`. |
| raw.githubusercontent.com (Streamtime data, `lib/store.js` `fetchDataFile`) | No published number. It is unauthenticated, so GitHub can throttle by IP, and it caches for about 5 minutes. | One fetch per data file per instance per minute (`DATA_TTL_MS` = 60 s). | `/api/data` returns 502, and the page shows stale or missing Streamtime data. Sign-in and boards keep working. | The page's own "Streamtime data couldn't be loaded" notice. Not part of the health card, because it does not use the token. |
| Weekly workflow's `GITHUB_TOKEN` | 1,000 requests an hour per repo | 2 requests a week | Not applicable | Not applicable |

**How the alerts reach you**

- **Weekly email:** `.github/workflows/usage-watch.yml` runs every Monday at 07:17 UTC, and you
  can also run it from Actions → Usage watch → Run workflow. It uses only the built-in
  `GITHUB_TOKEN` with `contents: read`. It counts `app-state` commits in the last 7 days, lists
  the state file sizes, and checks that `https://cand-c-platform.vercel.app/api/auth/status`
  answers `200`. It fails with an `::error::` explaining why. GitHub emails the owner when a
  scheduled workflow fails. Make sure Settings → Notifications → Actions is set to email.
- **In the app (admins):** Settings → About → **Service health** shows storage calls left this
  hour (from GitHub's `x-ratelimit-*` headers, which are per token), state saves in the last 7
  days, and a status dot. When the status is warn or alert, admins also see a quiet banner on
  the Dashboard. Both read `GET /api/health` (admins only), at most once every 10 minutes per
  page. The state-save count is one API request, cached 10 minutes on the server.
- **Thresholds:**
  - warn: under 25% of the hour's allowance left, or more than 2,000 state commits in 7 days.
  - alert: under 10% left, or a rate-limited answer from GitHub in the last hour.
  - The workflow fails above 3,000 commits a week, above 900 KB for any state file, or when
    `/api/auth/status` does not answer 200.
