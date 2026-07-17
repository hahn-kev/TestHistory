import type { Readable } from 'node:stream';
import type { TestCase, TestStatus } from '../model.js';
import { runSax, trxDurationToMs } from './sax-base.js';

/**
 * Visual Studio TRX (`<TestRun>`). Results and TestDefinitions are separate
 * sections joined by testId, and their order isn't guaranteed, so both are
 * buffered and joined on stream end. suite = `TestMethod className` (assembly
 * suffix stripped); name = the per-result `testName`, falling back to the
 * definition's `name`. Data-driven tests (`[DataRow]`) emit several results that
 * share one testId and differ only by `testName`, so results are kept as a list
 * per testId — collapsing them onto the testId would drop every row but the last
 * (and could mask a failing row behind a later passing one).
 */
export async function parseTRX(stream: Readable, onCase: (tc: TestCase) => void): Promise<void> {
  interface ResultRow {
    testName?: string;
    outcome: string;
    durationMs?: number;
    message?: string;
    stack?: string;
  }
  interface DefRow {
    suite: string;
    name: string;
  }

  const results = new Map<string, ResultRow[]>();
  const defs = new Map<string, DefRow>();

  let currentResult: { testId: string; row: ResultRow } | null = null;
  let currentDefId: string | null = null;
  let textTarget: 'message' | 'stack' | null = null;
  let textBuf = '';

  function mapOutcome(outcome: string | undefined): TestStatus {
    switch ((outcome ?? '').toLowerCase()) {
      case 'passed':
        return 'passed';
      case 'failed':
        return 'failed';
      case 'error':
        return 'error';
      case 'notexecuted':
      case 'inconclusive':
      case 'pending':
      case 'notrunnable':
      case 'disconnected':
      case 'warning':
        return 'skipped';
      default:
        return 'passed';
    }
  }

  // "Namespace.Class, Assembly, Version=..." → "Namespace.Class"
  function stripAssembly(className: string): string {
    const comma = className.indexOf(',');
    return comma >= 0 ? className.slice(0, comma).trim() : className.trim();
  }

  await runSax(stream, {
    onOpen(tag) {
      const a = tag.attributes;
      if (tag.name === 'UnitTestResult') {
        if (a.testId) {
          currentResult = {
            testId: a.testId,
            row: { testName: a.testName, outcome: a.outcome ?? '', durationMs: trxDurationToMs(a.duration) },
          };
        }
      } else if (tag.name === 'UnitTest') {
        currentDefId = a.id ?? null;
      } else if (tag.name === 'TestMethod' && currentDefId) {
        defs.set(currentDefId, {
          suite: stripAssembly(a.className ?? ''),
          name: a.name ?? '',
        });
      } else if (currentResult && tag.name === 'Message') {
        textTarget = 'message';
        textBuf = '';
      } else if (currentResult && tag.name === 'StackTrace') {
        textTarget = 'stack';
        textBuf = '';
      }
    },
    onText(text) {
      if (textTarget) textBuf += text;
    },
    onClose(tag) {
      if (tag.name === 'Message' && currentResult && textTarget === 'message') {
        const t = textBuf.trim();
        if (t) currentResult.row.message = t;
        textTarget = null;
      } else if (tag.name === 'StackTrace' && currentResult && textTarget === 'stack') {
        const t = textBuf.trim();
        if (t) currentResult.row.stack = t;
        textTarget = null;
      } else if (tag.name === 'UnitTestResult' && currentResult) {
        const list = results.get(currentResult.testId);
        if (list) list.push(currentResult.row);
        else results.set(currentResult.testId, [currentResult.row]);
        currentResult = null;
      } else if (tag.name === 'UnitTest') {
        currentDefId = null;
      }
    },
  });

  // Join: emit one case per result that has a matching definition. A result's
  // own `testName` distinguishes data-driven rows; fall back to the definition
  // name for the ordinary one-result-per-test case.
  for (const [testId, rows] of results) {
    const def = defs.get(testId);
    if (!def) continue;
    for (const res of rows) {
      onCase({
        suite: def.suite,
        name: res.testName ?? def.name,
        status: mapOutcome(res.outcome),
        durationMs: res.durationMs,
        message: res.message,
        stack: res.stack,
      });
    }
  }
}
