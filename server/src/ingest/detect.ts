import fs from 'node:fs';
import type { ResultFormat } from './model.js';

const SNIFF_BYTES = 64 * 1024;

/** Map a first-seen element name to a format. */
export function formatForElement(element: string): ResultFormat | null {
  switch (element) {
    case 'testsuites':
    case 'testsuite':
      return 'junit';
    case 'test-results':
      return 'nunit2';
    case 'test-run':
      return 'nunit3';
    case 'assemblies':
    case 'assembly':
      return 'xunit';
    case 'TestRun':
      return 'trx';
    default:
      return null;
  }
}

/** Find the first XML element name in a chunk of text (skips declarations, comments, PIs, DOCTYPE). */
export function firstElementName(text: string): string | null {
  const re = /<([A-Za-z_][\w.-]*)/g;
  let m: RegExpExecArray | null;
  // Strip comments so a commented-out element doesn't fool detection.
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, '');
  while ((m = re.exec(cleaned))) {
    const idx = m.index;
    const next = cleaned[idx + 1];
    // Skip <?xml ?>, <!DOCTYPE>, closing tags handled by the char class already.
    if (next === '?' || next === '!') continue;
    return m[1];
  }
  return null;
}

/**
 * Detect the format of a result file by sniffing its first 64KB for the root
 * element. An explicit `override` (from `?format=`) always wins. Returns null
 * when the format can't be determined.
 */
export function detect(filePath: string, override?: string): ResultFormat | null {
  if (override) {
    const norm = override.toLowerCase();
    if (['junit', 'nunit2', 'nunit3', 'xunit', 'trx'].includes(norm)) return norm as ResultFormat;
    return null;
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const bytes = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0);
    const text = buf.subarray(0, bytes).toString('utf8');
    const el = firstElementName(text);
    return el ? formatForElement(el) : null;
  } finally {
    fs.closeSync(fd);
  }
}
