import type { Readable } from 'node:stream';
import type { TestCase, TestStatus } from '../model.js';
import { runSax, secondsToMs } from './sax-base.js';

/**
 * JUnit XML (`<testsuites>`/`<testsuite>` → `<testcase>`). suite = `classname`,
 * name = `name`. A testcase is `passed` unless it contains `<failure>`
 * (failed), `<error>` (error), or `<skipped>` (skipped). The failure/error
 * message comes from the `message` attribute; the element text is the stack.
 */
export async function parseJUnit(stream: Readable, onCase: (tc: TestCase) => void): Promise<void> {
  let current: (TestCase & { _textInto?: 'stack' }) | null = null;
  let textBuf = '';
  let captureText = false;

  await runSax(stream, {
    onOpen(tag) {
      const a = tag.attributes;
      if (tag.name === 'testcase') {
        current = {
          suite: a.classname ?? a.className ?? '',
          name: a.name ?? '',
          status: 'passed',
          durationMs: secondsToMs(a.time),
        };
      } else if (current && (tag.name === 'failure' || tag.name === 'error' || tag.name === 'skipped')) {
        const status: TestStatus =
          tag.name === 'failure' ? 'failed' : tag.name === 'error' ? 'error' : 'skipped';
        current.status = status;
        if (a.message !== undefined) current.message = a.message;
        textBuf = '';
        captureText = true;
      }
    },
    onText(text) {
      if (captureText) textBuf += text;
    },
    onClose(tag) {
      if (tag.name === 'failure' || tag.name === 'error' || tag.name === 'skipped') {
        if (current && captureText) {
          const t = textBuf.trim();
          if (t) current.stack = t;
          // Fall back to element text as the message when no message attribute.
          if (current.message === undefined && t && tag.name !== 'skipped') current.message = t;
        }
        captureText = false;
        textBuf = '';
      } else if (tag.name === 'testcase' && current) {
        onCase(current);
        current = null;
      }
    },
  });
}
