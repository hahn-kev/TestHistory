import type { Readable } from 'node:stream';
import { SaxesParser, type SaxesTagPlain } from 'saxes';

export interface SaxHandlers {
  onOpen?: (tag: SaxesTagPlain) => void;
  onClose?: (tag: SaxesTagPlain) => void;
  onText?: (text: string) => void;
}

/**
 * Feed a Readable stream through a saxes parser, invoking handlers. Resolves
 * when the stream ends and the document closes; rejects on XML/stream error.
 * Streaming: chunks are written as they arrive, never buffering the whole file.
 */
export function runSax(stream: Readable, handlers: SaxHandlers): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser();
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      stream.destroy();
      reject(err);
    };

    if (handlers.onOpen) parser.on('opentag', handlers.onOpen);
    if (handlers.onClose) parser.on('closetag', handlers.onClose);
    if (handlers.onText) {
      parser.on('text', handlers.onText);
      parser.on('cdata', handlers.onText);
    }
    parser.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))));

    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      if (failed) return;
      try {
        parser.write(chunk);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
    stream.on('error', (e) => fail(e));
    stream.on('end', () => {
      if (failed) return;
      try {
        parser.close();
        resolve();
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/** Parse a float-seconds attribute into milliseconds, or undefined. */
export function secondsToMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n * 1000 : undefined;
}

/** Parse a TRX `hh:mm:ss.fffffff` duration into milliseconds. */
export function trxDurationToMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  return (h * 3600 + min * 60 + s) * 1000;
}

/** Last `.`-delimited segment of a dotted name (NUnit2 test method names). */
export function lastSegment(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1) : name;
}
