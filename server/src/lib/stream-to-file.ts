import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { AppError } from './errors.js';
import { newId } from './ids.js';

/**
 * Stream `source` to a fresh temp file under `dir`, never buffering the whole
 * body. Enforces `maxBytes` — on overflow the partial file is removed and an
 * `AppError(413, TOO_LARGE)` is raised. Returns the temp path and byte size.
 */
export function streamToTempFile(
  source: Readable,
  dir: string,
  maxBytes: number,
): Promise<{ tempPath: string; size: number }> {
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, newId());
  const out = fs.createWriteStream(tempPath);
  let size = 0;
  let overflow = false;

  return new Promise((resolve, reject) => {
    const cleanupReject = (err: Error) => {
      out.destroy();
      fs.rm(tempPath, { force: true }, () => reject(err));
    };

    source.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes && !overflow) {
        overflow = true;
        source.destroy();
        cleanupReject(new AppError(413, 'TOO_LARGE', 'Upload exceeds the maximum allowed size.'));
      }
    });
    source.on('error', (err) => {
      if (!overflow) cleanupReject(err);
    });
    out.on('error', (err) => {
      if (!overflow) cleanupReject(err);
    });
    out.on('finish', () => {
      if (!overflow) resolve({ tempPath, size });
    });
    source.pipe(out);
  });
}
