import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const JMDICT_URL = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';

export interface DownloadProgress {
  received: number;
  total: number | null;
}

interface DownloadOptions {
  destPath: string;
  url?: string;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Streams the gzipped JMdict file to disk, gunzipping on the fly. The result
 * is the path to a plain XML file. Re-downloads on every call — caller is
 * responsible for caching.
 */
export async function downloadAndDecompressJmdict(
  opts: DownloadOptions,
): Promise<string> {
  const url = opts.url ?? JMDICT_URL;
  fs.mkdirSync(path.dirname(opts.destPath), { recursive: true });

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`JMdict download failed: ${res.status} ${res.statusText}`);
  }

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;

  let received = 0;
  const reader = res.body.getReader();

  const source = new Readable({
    read() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            this.push(null);
            return;
          }
          received += value.byteLength;
          opts.onProgress?.({ received, total });
          this.push(Buffer.from(value));
        })
        .catch((err) => this.destroy(err));
    },
  });

  const gunzip = zlib.createGunzip();
  const out = fs.createWriteStream(opts.destPath);

  await pipeline(source, gunzip, out);
  return opts.destPath;
}
