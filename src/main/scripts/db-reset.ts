import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function resolveUserDataDir(): string {
  const productName = 'Japanese Reading Companion';
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', productName);
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
        productName,
      );
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'),
        productName,
      );
  }
}

function unlinkIfExists(p: string): boolean {
  try {
    fs.unlinkSync(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

const dir = resolveUserDataDir();
const targets = ['jrc.sqlite', 'jrc.sqlite-shm', 'jrc.sqlite-wal'];

let removed = 0;
for (const name of targets) {
  if (unlinkIfExists(path.join(dir, name))) {
    console.log('removed', path.join(dir, name));
    removed += 1;
  }
}

if (removed === 0) {
  console.log('no SQLite files to remove in', dir);
} else {
  console.log(`done — removed ${removed} file(s)`);
}
