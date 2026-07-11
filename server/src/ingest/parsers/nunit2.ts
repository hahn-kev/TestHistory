import type { Readable } from 'node:stream';
import type { TestCase, TestStatus } from '../model.js';
import { runSax, secondsToMs, lastSegment } from './sax-base.js';

/**
 * NUnit v2 (`<test-results>` → nested `<test-suite>` → `<test-case>`). The
 * suite is the nearest ancestor `<test-suite type="TestFixture">`; the test
 * name is the last dotted segment of the `<test-case>` name. Status comes from
 * `result`/`success`/`executed`; message + stack live in a `<failure>` or
 * `<reason>` child's `<message>`/`<stack-trace>` elements.
 */
export async function parseNUnit2(stream: Readable, onCase: (tc: TestCase) => void): Promise<void> {
  const fixtureStack: string[] = [];
  let current: TestCase | null = null;
  let textTarget: 'message' | 'stack' | null = null;
  let textBuf = '';

  function mapStatus(result: string | undefined, executed: string | undefined, success: string | undefined): TestStatus {
    if (executed && executed.toLowerCase() === 'false') return 'skipped';
    switch ((result ?? '').toLowerCase()) {
      case 'success':
        return 'passed';
      case 'failure':
        return 'failed';
      case 'error':
        return 'error';
      case 'ignored':
      case 'skipped':
      case 'notrunnable':
      case 'inconclusive':
        return 'skipped';
      default:
        if (success !== undefined) return success.toLowerCase() === 'true' ? 'passed' : 'failed';
        return 'passed';
    }
  }

  await runSax(stream, {
    onOpen(tag) {
      const a = tag.attributes;
      if (tag.name === 'test-suite') {
        // Track fixture names so a test-case can name its enclosing fixture.
        fixtureStack.push((a.type === 'TestFixture' ? a.name : '') ?? '');
      } else if (tag.name === 'test-case') {
        const fixture = [...fixtureStack].reverse().find((f) => f) ?? '';
        current = {
          suite: fixture,
          name: lastSegment(a.name ?? ''),
          status: mapStatus(a.result, a.executed, a.success),
          durationMs: secondsToMs(a.time),
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
      } else if (tag.name === 'test-suite') {
        fixtureStack.pop();
      }
    },
  });
}
