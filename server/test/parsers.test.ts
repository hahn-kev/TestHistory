import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, firstElementName, formatForElement } from '../src/ingest/detect.js';
import { parseFileToArray, dedupeLastWins } from '../src/ingest/parse.js';
import { trxDurationToMs, secondsToMs, lastSegment } from '../src/ingest/parsers/sax-base.js';
import type { ResultFormat } from '../src/ingest/model.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fx = (name: string) => path.join(FIX, name);

describe('detection', () => {
  test.each([
    ['<testsuites>', 'junit'],
    ['<testsuite>', 'junit'],
    ['<test-results>', 'nunit2'],
    ['<test-run>', 'nunit3'],
    ['<assemblies>', 'xunit'],
    ['<assembly>', 'xunit'],
    ['<TestRun>', 'trx'],
    ['<unknown>', null],
  ])('first element %s → %s', (xml, expected) => {
    const el = firstElementName(xml)!;
    expect(formatForElement(el)).toBe(expected);
  });

  test('firstElementName skips declaration, comments, DOCTYPE', () => {
    const xml = `<?xml version="1.0"?>\n<!-- <fake> -->\n<!DOCTYPE x>\n<TestRun>`;
    expect(firstElementName(xml)).toBe('TestRun');
  });

  test.each([
    ['junit-mixed.xml', 'junit'],
    ['nunit2-mixed.xml', 'nunit2'],
    ['nunit3-mixed.xml', 'nunit3'],
    ['xunit-mixed.xml', 'xunit'],
    ['trx-mixed.xml', 'trx'],
  ])('detect(%s) → %s', (file, expected) => {
    expect(detect(fx(file))).toBe(expected);
  });

  test('explicit format override wins', () => {
    expect(detect(fx('junit-mixed.xml'), 'trx')).toBe('trx');
    expect(detect(fx('junit-mixed.xml'), 'bogus')).toBe(null);
  });
});

describe('duration helpers', () => {
  test('secondsToMs', () => {
    expect(secondsToMs('0.012')).toBeCloseTo(12);
    expect(secondsToMs(undefined)).toBeUndefined();
    expect(secondsToMs('abc')).toBeUndefined();
  });
  test('trxDurationToMs', () => {
    expect(trxDurationToMs('00:00:00.0120000')).toBeCloseTo(12);
    expect(trxDurationToMs('00:00:01.5000000')).toBeCloseTo(1500);
    expect(trxDurationToMs('01:02:03')).toBeCloseTo((3600 + 120 + 3) * 1000);
    expect(trxDurationToMs('bad')).toBeUndefined();
  });
  test('lastSegment', () => {
    expect(lastSegment('A.B.C')).toBe('C');
    expect(lastSegment('flat')).toBe('flat');
  });
});

async function parse(file: string, format: ResultFormat) {
  return dedupeLastWins(await parseFileToArray(fx(file), format));
}

describe('JUnit', () => {
  test('mixed statuses', async () => {
    const cases = await parse('junit-mixed.xml', 'junit');
    expect(cases).toMatchSnapshot();
    expect(cases.map((c) => c.status)).toEqual(['passed', 'failed', 'error', 'skipped']);
    expect(cases[0].durationMs).toBeCloseTo(12);
  });
  test('edge: single suite, empty classname, dup last-wins, message from text', async () => {
    const cases = await parse('junit-edge.xml', 'junit');
    // dup (pkg.Flaky, sometimes) collapses to the last (passed)
    expect(cases).toHaveLength(2);
    const flaky = cases.find((c) => c.name === 'sometimes')!;
    expect(flaky.status).toBe('passed');
    expect(cases.find((c) => c.name === 'orphan')!.suite).toBe('');
    expect(cases).toMatchSnapshot();
  });
});

describe('NUnit2', () => {
  test('mixed statuses, fixture ancestry, last name segment', async () => {
    const cases = await parse('nunit2-mixed.xml', 'nunit2');
    expect(cases.map((c) => [c.suite, c.name, c.status])).toEqual([
      ['Suite.CalculatorTests', 'Adds', 'passed'],
      ['Suite.CalculatorTests', 'Subtracts', 'failed'],
      ['Suite.CalculatorTests', 'Divides', 'error'],
      ['Suite.CalculatorTests', 'Ignored', 'skipped'],
    ]);
    expect(cases).toMatchSnapshot();
  });
  test('edge: nested fixtures + inconclusive', async () => {
    const cases = await parse('nunit2-edge.xml', 'nunit2');
    expect(cases[0]).toMatchObject({ suite: 'Outer.Inner.Fixture', name: 'DeeplyNamed', status: 'passed' });
    expect(cases[1].status).toBe('skipped');
  });
});

describe('NUnit3', () => {
  test('mixed: label=Error promotes to error', async () => {
    const cases = await parse('nunit3-mixed.xml', 'nunit3');
    expect(cases.map((c) => c.status)).toEqual(['passed', 'failed', 'error', 'skipped']);
    expect(cases[0].durationMs).toBeCloseTo(1.234, 2);
    expect(cases).toMatchSnapshot();
  });
  test('edge: inconclusive→skipped, empty classname, CDATA message', async () => {
    const cases = await parse('nunit3-edge.xml', 'nunit3');
    expect(cases[0].suite).toBe('');
    expect(cases[1].status).toBe('skipped');
    expect(cases[2].message).toContain('boom < & > happened');
  });
});

describe('xUnit', () => {
  test('mixed statuses + skip reason', async () => {
    const cases = await parse('xunit-mixed.xml', 'xunit');
    expect(cases.map((c) => [c.suite, c.name, c.status])).toEqual([
      ['MyLib.Tests.ParserTests', 'Parses', 'passed'],
      ['MyLib.Tests.ParserTests', 'Rejects', 'failed'],
      ['MyLib.Tests.ParserTests', 'Later', 'skipped'],
    ]);
    expect(cases[2].message).toBe('waiting on upstream');
    expect(cases).toMatchSnapshot();
  });
  test('edge: single <assembly> root, dup last-wins', async () => {
    const cases = await parse('xunit-edge.xml', 'xunit');
    expect(cases).toHaveLength(1);
    expect(cases[0].status).toBe('passed');
  });
});

describe('TRX', () => {
  test('mixed: joins definitions to results, strips assembly, parses duration', async () => {
    const cases = await parse('trx-mixed.xml', 'trx');
    const byName = Object.fromEntries(cases.map((c) => [c.name, c]));
    expect(byName.Passes).toMatchObject({ suite: 'MyApp.Tests.Fixture', status: 'passed' });
    expect(byName.Breaks).toMatchObject({ status: 'failed', message: 'Assert.AreEqual failed' });
    expect(byName.Breaks.durationMs).toBeCloseTo(1500);
    expect(byName.Skips.status).toBe('skipped');
    expect(cases).toHaveLength(3);
  });
  test('edge: definitions before results (order-independent); orphan result dropped', async () => {
    const cases = await parse('trx-edge.xml', 'trx');
    expect(cases.map((c) => c.name).sort()).toEqual(['Erroring', 'OnlyDef']);
    expect(cases.find((c) => c.name === 'Erroring')!.status).toBe('error');
  });
});
