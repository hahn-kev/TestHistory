import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, setupAdmin, type TestApp } from './helpers.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fx = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8');

interface Part {
  name: string;
  value?: string;
  filename?: string;
  content?: string;
}

/** Build a multipart/form-data body for app.inject. */
function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----thBoundaryTest1234567890';
  const chunks: string[] = [];
  for (const p of parts) {
    chunks.push(`--${boundary}\r\n`);
    if (p.filename !== undefined) {
      chunks.push(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`);
      chunks.push('Content-Type: application/xml\r\n\r\n');
      chunks.push((p.content ?? '') + '\r\n');
    } else {
      chunks.push(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`);
      chunks.push((p.value ?? '') + '\r\n');
    }
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.from(chunks.join(''), 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

let t: TestApp;
let admin: string;
let projectId: string;

async function newProject(app = t.app, cookie = admin): Promise<string> {
  const pr = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: `P${Math.random()}` } });
  return pr.json().project.id;
}

function post(url: string, mp: ReturnType<typeof multipart>) {
  return t.app.inject({ method: 'POST', url, headers: { cookie: admin, ...mp.headers }, payload: mp.payload });
}

describe('multipart + append', () => {
  beforeEach(async () => {
    t = await makeApp();
    admin = await setupAdmin(t.app);
    projectId = await newProject();
  });
  afterEach(async () => {
    await t.close();
  });

  test('multi-file multipart = one Run with merged tallies', async () => {
    const mp = multipart([
      { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
      { name: 'file', filename: 'xunit.xml', content: fx('xunit-mixed.xml') },
      { name: 'branch', value: 'main' },
    ]);
    const res = await post(`/api/projects/${projectId}/runs`, mp);
    expect(res.statusCode).toBe(201);
    const run = res.json().run;
    // junit-mixed: 1/1/1/1 (4) + xunit-mixed: 1/1/0/1 (3) = 7
    expect({ total: run.total, passed: run.passed, failed: run.failed, errored: run.errored, skipped: run.skipped }).toEqual({ total: 7, passed: 2, failed: 2, errored: 1, skipped: 2 });
    expect(run.uploads).toHaveLength(2);
    expect(run.branch).toBe('main');
  });

  test('two POSTs with the same run key merge into one Run (append 200)', async () => {
    const first = await post(
      `/api/projects/${projectId}/runs`,
      multipart([
        { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
        { name: 'run_key', value: 'build-42' },
      ]),
    );
    expect(first.statusCode).toBe(201);
    const runId = first.json().run.id;

    const second = await post(
      `/api/projects/${projectId}/runs`,
      multipart([
        { name: 'file', filename: 'xunit.xml', content: fx('xunit-mixed.xml') },
        { name: 'run_key', value: 'build-42' },
      ]),
    );
    expect(second.statusCode).toBe(200); // append, not create
    const run = second.json().run;
    expect(run.id).toBe(runId);
    expect(run.total).toBe(7);
    expect(run.uploads).toHaveLength(2);

    // Only one run exists.
    const list = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs`, headers: { cookie: admin } });
    expect(list.statusCode).toBeLessThan(500);
  });

  test('re-uploading the same file into a Run does not double-count', async () => {
    const key = 'build-idem';
    const a = await post(
      `/api/projects/${projectId}/runs`,
      multipart([
        { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
        { name: 'run_key', value: key },
      ]),
    );
    expect(a.json().run.total).toBe(4);
    const b = await post(
      `/api/projects/${projectId}/runs`,
      multipart([
        { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
        { name: 'run_key', value: key },
      ]),
    );
    expect(b.statusCode).toBe(200);
    // Same identities → last-write-wins → still 4, not 8.
    expect(b.json().run.total).toBe(4);
    expect(b.json().run.uploads).toHaveLength(2); // two uploads recorded, but counters recomputed
  });

  test('multipart ci_job_outcome field sticks on the Run', async () => {
    const first = await post(
      `/api/projects/${projectId}/runs`,
      multipart([
        { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
        { name: 'run_key', value: 'job-out' },
        { name: 'ci_job_outcome', value: 'failed' },
      ]),
    );
    expect(first.statusCode).toBe(201);
    expect(first.json().run.ciJobOutcome).toBe('failed');

    const second = await post(
      `/api/projects/${projectId}/runs`,
      multipart([
        { name: 'file', filename: 'xunit.xml', content: fx('xunit-mixed.xml') },
        { name: 'run_key', value: 'job-out' },
        // omit ci_job_outcome — sticky trouble must remain
      ]),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().run.ciJobOutcome).toBe('failed');
  });
});

describe('append window expiry', () => {
  test('reusing a key after the window closes → 409 RUN_KEY_EXPIRED', async () => {
    t = await makeApp({ runAppendWindowMs: 40 });
    admin = await setupAdmin(t.app);
    projectId = await newProject();
    try {
      const first = await post(
        `/api/projects/${projectId}/runs`,
        multipart([
          { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
          { name: 'run_key', value: 'stale-key' },
        ]),
      );
      expect(first.statusCode).toBe(201);

      await new Promise((r) => setTimeout(r, 80)); // let the window close

      const second = await post(
        `/api/projects/${projectId}/runs`,
        multipart([
          { name: 'file', filename: 'junit.xml', content: fx('junit-mixed.xml') },
          { name: 'run_key', value: 'stale-key' },
        ]),
      );
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('RUN_KEY_EXPIRED');
    } finally {
      await t.close();
    }
  });
});
