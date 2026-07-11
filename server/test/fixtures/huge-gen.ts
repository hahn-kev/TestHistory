import fs from 'node:fs';

/**
 * Generate a large JUnit XML file (~targetBytes) by streaming testcases, for
 * the ingest latency probe. Resolves with the number of test cases written
 * once the file is fully flushed to disk.
 */
export function generateHugeJUnit(filePath: string, targetBytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    out.on('error', reject);
    out.write('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="huge">\n');
    let written = 0;
    let count = 0;
    while (written < targetBytes) {
      // Roughly 1 in 10 fails so counters are non-trivial.
      const fail = count % 10 === 0;
      const line = fail
        ? `<testcase classname="huge.Suite${count % 50}" name="test_${count}" time="0.001"><failure message="boom ${count}">stack for ${count}</failure></testcase>\n`
        : `<testcase classname="huge.Suite${count % 50}" name="test_${count}" time="0.001"/>\n`;
      out.write(line);
      written += Buffer.byteLength(line);
      count++;
    }
    out.write('</testsuite>\n</testsuites>\n');
    out.end(() => resolve(count));
  });
}

// Allow running directly: `tsx huge-gen.ts <path> <mb>`
if (process.argv[1] && process.argv[1].endsWith('huge-gen.ts')) {
  const path = process.argv[2] ?? 'huge.xml';
  const mb = Number(process.argv[3] ?? '50');
  const n = generateHugeJUnit(path, mb * 1024 * 1024);
  console.log(`wrote ${n} cases to ${path}`);
}
