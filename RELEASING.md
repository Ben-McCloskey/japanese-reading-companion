# Releasing & auto-updates

The app uses `electron-updater` pointed at the public GitHub repo
[`Ben-McCloskey/japanese-reading-companion`](https://github.com/Ben-McCloskey/japanese-reading-companion).
Once the one-time setup is done, every release is two commands plus one click.

> **Why public?** electron-updater 6.x has multiple unfixed bugs for private
> GitHub repos: the runtime ignores `private: true`, hits the wrong URLs, and
> the asset-download endpoint refuses Authorization headers. Patching around
> them turned into whack-a-mole. The source has nothing sensitive, so going
> public was the cleaner fix and the auto-updater works on stock
> electron-updater behavior.

---

## One-time setup (already done on this machine, kept for reference)

### 1. Public GitHub repo

Already exists: [`Ben-McCloskey/japanese-reading-companion`](https://github.com/Ben-McCloskey/japanese-reading-companion).
The owner+repo pair is hard-coded in `electron-builder.yml` → `publish.owner`/`publish.repo`.

### 2. `GH_TOKEN` for the upload step

`electron-builder` needs a Classic Personal Access Token to upload release
artifacts to GitHub. (The installed app doesn't need a token — it reads from
the public repo anonymously.)

To regenerate the token if it ever expires:

1. Go to https://github.com/settings/tokens (Classic, **not** fine-grained).
2. **Generate new token (classic)** → name: `Japanese Reading Companion releases`.
3. Scope: just **`public_repo`** (or `repo` if you want the option to flip
   private later).
4. Copy the token, then add to your shell profile:

   ```bash
   export GH_TOKEN="ghp_..."
   ```

   Already set in `~/.zshrc`. Reload your shell or open a new terminal.

5. Verify: `echo $GH_TOKEN` should print something.

---

## Per-release workflow

```bash
# bump version (creates a git tag if you're in a git repo)
npm version patch          # 0.1.x → 0.1.(x+1)
# (or `minor` / `major`)

# build, sign ad-hoc, upload draft to GitHub
npm run release
```

`npm run release` does:

1. `electron-vite build` — bundles main / preload / renderer with the new
   version baked into the sidebar footer.
2. `electron-builder --publish always` — packages DMG + ZIP, signs ad-hoc,
   creates a GitHub Release tagged `v0.1.x` with the artifacts attached and
   `latest-mac.yml` for the updater.

By default the release is created as a **draft**. Go to your GitHub repo's
Releases page, find the draft, and click **Publish release**. Now installed
copies of the app see the update on their next check (and immediately on
launch).

---

## What the user sees

- App checks for updates on launch and every 30 min after.
- Sidebar footer is reactive:
  - `vX.Y.Z` — idle (whatever version is installed).
  - `downloading update… 47%` — a new release is downloading in the
    background.
  - **Update ready · vX.Y.(Z+1) · click to restart** — pulsing accent
    button. Click → app quits and relaunches on the new version. SQLite,
    deck, review history all preserved.
- All happens silently if there's no update.
- Dev mode (`npm run dev`) skips the updater entirely.

---

## Troubleshooting

**"401 Unauthorized" when running `npm run release`**
`GH_TOKEN` isn't set or doesn't have the `public_repo` (or `repo`) scope.
Verify with `echo $GH_TOKEN`. The token must be a **Classic** PAT — fine-
grained tokens don't work with electron-builder's GitHub uploader.

**"Update check failed" in the sidebar**
Open the main-process logs at
`~/Library/Logs/Japanese Reading Companion/main.log`. The actual
electron-updater error is logged there. Common causes: rate-limited by
GitHub (rare for our volume), no network, or you haven't published the
draft release yet.

**Want to test the release locally without publishing**
Run `npm run package` (no `--publish`). Artifacts land in
`release/<version>/` but nothing is uploaded.
