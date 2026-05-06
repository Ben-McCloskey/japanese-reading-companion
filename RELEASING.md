# Releasing & auto-updates

The app uses `electron-updater` pointed at a private GitHub Releases repo.
Once the one-time setup is done, every release is two commands.

---

## One-time setup (~5 min)

### 1. Create the private GitHub repo

On github.com, create a new repository:

- **Name**: `japanese-reading-companion` (must match `electron-builder.yml` → `publish.repo`)
- **Visibility**: Private
- It can be empty. We don't push source code there — only release artifacts.

You don't have to push the code to it. Releases are uploaded via the GitHub
API by `electron-builder`.

### 2. Plug your username into the publish config

Edit [`electron-builder.yml`](electron-builder.yml) and replace
`REPLACE_WITH_GH_USERNAME` with your actual GitHub username:

```yaml
publish:
  - provider: github
    owner: YOUR_GH_USERNAME       # <-- here
    repo: japanese-reading-companion
    private: true
```

### 3. Generate a Classic Personal Access Token

Go to https://github.com/settings/tokens (Classic tokens, **not** fine-grained
— `electron-updater` needs the older API).

- Click **Generate new token (classic)**
- Note: `Japanese Reading Companion releases`
- Expiration: **No expiration** (or whatever you prefer; you'll need to rotate
  it when it expires)
- Scopes: only **`repo`** (full control of private repositories)
- Click **Generate token**
- Copy it somewhere safe — you only see it once

### 4. Store the token

Add it to your shell profile (`~/.zshrc` or similar) so every release picks it
up automatically:

```bash
export GH_TOKEN="ghp_..."   # your classic PAT
```

Reload your shell (`source ~/.zshrc` or open a new terminal).

⚠️ **Security note**: this token gets baked into the app's `app-update.yml`
file at build time so the running app can fetch private releases. Anyone who
gets a copy of your `.app` bundle can extract it and read your private repo.
For a personal app on your own machines this is acceptable; just don't share
the bundle. Rotate the token if it leaks.

---

## Per-release workflow

```bash
# bump version (also commits if you're in a git repo)
npm version patch          # 0.1.0 → 0.1.1
# (or `minor` / `major`)

# build, sign, upload to GitHub Releases as a draft
npm run release
```

`npm run release` does:

1. `electron-vite build` — bundles main / preload / renderer
2. `electron-builder --publish always` — packages DMG + ZIP, signs ad-hoc,
   creates a GitHub Release tagged `v0.1.1` with the artifacts attached and
   `latest-mac.yml` for the updater.

By default the release is created as a **draft**. Go to your GitHub repo's
Releases page, find the new draft, and click **Publish release**. Now installed
copies of the app will see the update on their next check.

---

## What users see

- App checks for updates on launch and every 30 min after.
- Sidebar footer shows quiet status text:
  - `v0.1.0` — idle (or whatever the installed version is)
  - `downloading update… 47%` — a new release is downloading in the background
  - **Update ready · v0.1.1 · click to restart** — pulsing accent button.
    Click it → app quits and relaunches on the new version.
- All happens silently if there's no update.
- Dev mode (`npm run dev`) skips the updater entirely.

---

## Troubleshooting

**"401 Unauthorized" when running `npm run release`**
Token isn't set or doesn't have `repo` scope. Verify with `echo $GH_TOKEN`.
The token must be a **Classic** PAT (fine-grained tokens don't work with
`electron-updater`'s GitHub provider).

**App says "update check failed" in the sidebar**
Open dev tools (or check the main-process console in the packaged app's logs
at `~/Library/Logs/Japanese Reading Companion/`) — the actual error is logged.
Most common: token expired or got revoked.

**Want to test the updater flow without actually releasing**
Bump the version locally, run `npm run package` (no publish), and manually
copy the artifacts to a draft GitHub release. Or just trust the flow: it
follows the standard `electron-updater` pattern, no surprises.
