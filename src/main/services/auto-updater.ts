import { autoUpdater } from 'electron-updater';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ghProvider = require('electron-updater/out/providers/GitHubProvider');
import type { UpdateStatus } from '@shared/ipc';

/**
 * Workaround for electron-updater 6.x: `getLatestTagName` always hits
 * `https://github.com/<owner>/<repo>/releases/latest` (the web redirect)
 * regardless of `private: true`. That URL returns 404 for private repos even
 * with an Authorization header, breaking the entire update flow for private
 * GitHub repos. We monkey-patch the prototype to use the API URL instead.
 *
 * Tracking: https://github.com/electron-userland/electron-builder/issues/3406
 */
type Patchable = {
  prototype: {
    getLatestTagName: (
      this: {
        options: { owner: string; repo: string };
        baseApiUrl: URL;
        computeGithubBasePath: (s: string) => string;
        httpRequest: (
          url: URL,
          headers: Record<string, string>,
          token: unknown,
        ) => Promise<string | null>;
      },
      cancellationToken: unknown,
    ) => Promise<string | null>;
  };
};
const patchTarget = (ghProvider as { GitHubProvider: Patchable }).GitHubProvider;
patchTarget.prototype.getLatestTagName = async function (cancellationToken) {
  const { owner, repo } = this.options;
  const path = this.computeGithubBasePath(`/repos/${owner}/${repo}/releases`);
  const url = new URL(`${path}/latest`, this.baseApiUrl);
  const raw = await this.httpRequest(
    url,
    { Accept: 'application/json' },
    cancellationToken,
  );
  if (raw == null) return null;
  return (JSON.parse(raw) as { tag_name: string }).tag_name;
};

interface UpdaterDeps {
  onStatus: (status: UpdateStatus) => void;
}

/**
 * Wires `electron-updater` into our IPC pipe. Checks once on app start, then
 * every 30 minutes while the app is open. Downloads happen automatically; the
 * user clicks "install" in the renderer to trigger `quitAndInstall`.
 */
export function startAutoUpdater(deps: UpdaterDeps): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Quieter logs unless we actually need them.
  autoUpdater.logger = console;

  // electron-builder doesn't bake GH_TOKEN into app-update.yml, so we set the
  // Authorization header here. The token is injected at build time via Vite
  // `define` (see electron.vite.config.ts) and ends up as a string literal in
  // the compiled main bundle. Without it the updater falls back to the public
  // releases.atom feed, which 404s on private repos.
  if (__GH_TOKEN__) {
    autoUpdater.requestHeaders = {
      Authorization: `token ${__GH_TOKEN__}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }

  autoUpdater.on('checking-for-update', () => {
    deps.onStatus({ kind: 'checking' });
  });
  autoUpdater.on('update-not-available', () => {
    deps.onStatus({ kind: 'idle' });
  });
  autoUpdater.on('update-available', (info) => {
    deps.onStatus({ kind: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    deps.onStatus({
      kind: 'downloading',
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    deps.onStatus({ kind: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    deps.onStatus({
      kind: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Initial check + recurring poll. We don't await these — they run in the
  // background and emit status updates as they progress.
  void runCheck();
  setInterval(runCheck, 30 * 60 * 1000);
}

async function runCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // Errors flow through the 'error' event handler above.
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
