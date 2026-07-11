import type { Readable } from 'node:stream';
import type { TestCase, TestStatus } from '../model.js';
import { runSax, secondsToMs } from './sax-base.js';

/**
 * xUnit.net XML (`<assemblies>`/`<assembly>` → `<collection>` → `<test>`).
 * suite = `type`, name = `method`. Status from `result` (Pass/Fail/Skip);
 * message/stack from a `<failure>` child, skip reason from `<reason>`.
 */
export async function parseXUnit(stream: Readable, onCase: (tc: TestCase) => void): Promise<void> {
  let current: TestCase | null = null;
  let textTarget: 'message' | 'stack' | 'reason' | null = null;
  let textBuf = '';

  function mapStatus(result: string | undefined): TestStatus {
    switch ((result ?? '').toLowerCase()) {
      case 'pass':
        return 'passed';
      case 'fail':
        return 'failed';
      case 'skip':
        return 'skipped';
      default:
        return 'passed';
    }
  }

  await runSax(stream, {
    onOpen(tag) {
      const a = tag.attributes;
      if (tag.name === 'test') {
        current = {
          suite: a.type ?? '',
          name: a.method ?? a.name ?? '',
          status: mapStatus(a.result),
          durationMs: secondsToMs(a.time),
        };
      } else if (current && tag.name === 'message') {
        textTarget = 'message';
        textBuf = '';
      } else if (current && tag.name === 'stack-trace') {
        textTarget = 'stack';
        textBuf = '';
      } else if (current && tag.name === 'reason') {
        textTarget = 'reason';
        textBuf = '';
      }
    },
    onText(text) {
      if (textTarget) textBuf += text;
    },
    onClose(tag) {
      if (!current) return;
      const t = textBuf.trim();
      if (tag.name === 'message' && textTarget === 'message') {
        if (t) current.message = t;
        textTarget = null;
      } else if (tag.name === 'stack-trace' && textTarget === 'stack') {
        if (t) current.stack = t;
        textTarget = null;
      } else if (tag.name === 'reason' && textTarget === 'reason') {
        if (t) current.message = t;
        textTarget = null;
      } else if (tag.name === 'test') {
        onCase(current);
        current = null;
      }
    },
  });
}
