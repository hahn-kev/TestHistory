import type { Readable } from 'node:stream';
import type { TestCase, TestStatus } from '../model.js';
import { runSax, secondsToMs } from './sax-base.js';

/**
 * NUnit v3 (`<test-run>` → nested `<test-suite>` → `<test-case>`). suite =
 * `classname`, name = `name`. Status from `result` (+ `label="Error"` promotes
 * a failure to `error`); message/stack from a `<failure>` child.
 */
export async function parseNUnit3(stream: Readable, onCase: (tc: TestCase) => void): Promise<void> {
  let current: TestCase | null = null;
  let textTarget: 'message' | 'stack' | null = null;
  let textBuf = '';

  function mapStatus(result: string | undefined, label: string | undefined): TestStatus {
    const r = (result ?? '').toLowerCase();
    if (r === 'passed') return 'passed';
    if (r === 'skipped' || r === 'inconclusive' || r === 'warning') return 'skipped';
    if (r === 'failed') return (label ?? '').toLowerCase() === 'error' ? 'error' : 'failed';
    return 'passed';
  }

  await runSax(stream, {
    onOpen(tag) {
      const a = tag.attributes;
      if (tag.name === 'test-case') {
        current = {
          suite: a.classname ?? '',
          name: a.name ?? a.methodname ?? '',
          status: mapStatus(a.result, a.label),
          durationMs: secondsToMs(a.duration),
        };
      } else if (current && tag.name === 'message') {
        textTarget = 'message';
        textBuf = '';
      } else if (current && tag.name === 'stack-trace') {
        textTarget = 'stack';
        textBuf = '';
      }
    },
    onText(text) {
      if (textTarget) textBuf += text;
    },
    onClose(tag) {
      if (tag.name === 'message' && current && textTarget === 'message') {
        const t = textBuf.trim();
        if (t) current.message = t;
        textTarget = null;
      } else if (tag.name === 'stack-trace' && current && textTarget === 'stack') {
        const t = textBuf.trim();
        if (t) current.stack = t;
        textTarget = null;
      } else if (tag.name === 'test-case' && current) {
        onCase(current);
        current = null;
      }
    },
  });
}
