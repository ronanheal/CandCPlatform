# Sign-in and encrypted data: setup

The platform now has real accounts (email + password) and the synced Streamtime data is
encrypted on the public `streamtime-data` branch. This is a testing-scale setup; the backend is
expected to be rebuilt by another agency later.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| `middleware.js` | Vercel Routing Middleware | Every request needs a signed session cookie, except `/login.html` and `/api/auth/{login,logout,status,request,password}`. Pages redirect to `/login.html`; API calls get `401`. A session with a pending password change only reaches those public paths. |
| `api/auth/[action].js` | `/api/auth/*` | Sign in, sign out, status, "Request access", change password. |
| `api/me.js` | `/api/me` | `{email, name, personKey, admin}` for the signed-in person. |
| `api/access.js` | `/api/access` | Admins only: list, add, reset password, link person, admin on/off, remove, approve, decline. |
| `api/data/[file].js` | `/api/data/<file>.json` | Fetches `<file>.json.enc` from the public branch, decrypts it with `DATA_KEY`, returns it **still gzipped** (`Content-Encoding: gzip`). |
| `scripts/data_crypt.py` + `scripts/sync_loop.sh` | GitHub Actions | The sync writes `<name>.json.enc` next to each file it owns, and (later) stops writing the readable copies. |
| `login.html` | `/login.html` | Sign-in, request-access and forced change-password forms. |
| Settings → Team → **Access** | `index.html` | The admin UI for the list above. |

**Accounts** live in `auth/access.json.enc` in a **private Vercel Blob store**, encrypted with
`DATA_KEY` (AES-256-GCM). Passwords are hashed with scrypt (`scrypt$N$r$p$salt$hash`).
Admins never see or choose other people's passwords. Adding someone or resetting a password
creates a one-time temporary password, which is shown once. The person must change it at first
sign-in.

**Admins** are `ADMIN_EMAILS` (always admin) plus anyone given admin in Settings → Team → Access.

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
openssl rand -hex 32   # → DATA_KEY       (64 hex chars; the same value goes to GitHub AND Vercel)
openssl rand -hex 32   # → SESSION_SECRET (Vercel only)
```

Keep `DATA_KEY` somewhere safe, such as a password manager. Without it the encrypted data can't
be read. If it is lost, set a new one and let the next full sync re-publish.

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

### 3. Vercel: Blob store and environment variables

```bash
# Private Blob store for the account list, connected to this project (all environments):
vercel blob create-store cc-platform-accounts --access private --yes

# Secrets (each command asks for the value; add to Production, and Preview if you use previews):
vercel env add SESSION_SECRET production
vercel env add DATA_KEY production
vercel env add ADMIN_EMAILS production      # e.g. ronan@contentandco.com.au  (comma-separated for several)
```

Connecting the store gives the functions their Blob credentials (OIDC, or
`BLOB_READ_WRITE_TOKEN` if you tick that option). Nothing else is needed, and there is no GitHub
token on Vercel.

Then redeploy so the new env vars apply: `vercel --prod`, or push or merge to `main`.

> Deploying this code to `main` before step 3 locks everyone out, because the middleware fails
> closed without `SESSION_SECRET`, and the data proxy needs `DATA_KEY` and the `.enc` files.
> Do steps 1–3 first, then merge.

### 4. Create the first admin account (you)

1. Open https://cand-c-platform.vercel.app. It redirects to the sign-in page.
2. Click **Request access**. Enter your full name, the email you put in `ADMIN_EMAILS`, and a
   password (10+ characters).
3. Because that email is in `ADMIN_EMAILS` and has no account yet, and your name or email
   matches an active Streamtime user, the account is created straight away as an admin. Sign in.

Do this right after deploying. Until you do, anyone who knows your admin email and your
Streamtime name could claim it first.

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
  full name (or Streamtime email) and a password of their choice. Requests appear under "Waiting
  for approval". **Approve** keeps the password they chose. **Decline** deletes the request. At
  most 50 requests can wait at once.
- **Change your own password:** avatar (bottom left) → Change password.
- **View as someone else** (admins, for support): avatar → View as someone else. You stay signed
  in as yourself. Use **Back to me** to return.

## Local testing

- `python3 -m http.server` on `localhost` / `127.0.0.1` still works with no sign-in, the old
  "who am I" picker and the plaintext raw URLs, **as long as the plaintext files are still
  published**.
- After step 6, the plaintext is gone, so use `vercel dev` with the env vars pulled
  (`vercel env pull .env.local`). That runs the middleware, sign-in and `/api/data`, which needs
  `DATA_KEY`. Open it at the URL `vercel dev` prints.
- Tests: `node scripts/test_auth.mjs` (add `PYTHON=/path/to/python` for the Python interop
  check) and `bash scripts/test_sync_crypt.sh` (needs `python3` with `cryptography`).

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
