// Cross-platform dev runner: build shared once, then run server + web watchers
// together, streaming both outputs with a label prefix. Ctrl-C stops both.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, args, color) {
  const child = spawn(npm, args, { shell: false });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

// Build shared first so server (tsx) and web resolve its dist output.
const build = spawn(npm, ['run', 'build', '-w', 'shared'], { shell: false, stdio: 'inherit' });

build.on('exit', (code) => {
  if (code !== 0) {
    console.error('shared build failed; aborting dev');
    process.exit(code ?? 1);
  }
  const server = run('server', ['run', 'dev', '-w', 'server'], '36');
  const web = run('web', ['run', 'dev', '-w', 'web'], '35');

  const shutdown = () => {
    server.kill();
    web.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  for (const child of [server, web]) {
    child.on('exit', (c) => {
      if (c && c !== 0) shutdown();
    });
  }
});
