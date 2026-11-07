import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';
import { defaultAppDir, parseArgs, USAGE, type LauncherArgs, type LauncherMode } from './args';
import { startBackend, waitForPort } from './backend-process';
import { buildBackendEnv, type MariadbConnection } from './env';
import { openBrowser } from './open-browser';
import { findFreePort, listenOnFreePort } from './ports';
import { Prompter, promptMariadb, promptMode } from './prompts';
import { createProxy } from './proxy';
import { generateKey, loadOrCreateServerKey } from './server-key';

const BACKEND_START_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const args: LauncherArgs = parseArgs(process.argv.slice(2), defaultAppDir(__dirname));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  let mode: LauncherMode | undefined = args.mode;
  let mariadb: MariadbConnection | undefined;
  const prompter: Prompter = new Prompter();
  try {
    mode ??= await promptMode(prompter);
    if (mode === 'mariadb') mariadb = await promptMariadb(prompter);
  } finally {
    prompter.close();
  }

  const proxySecret: string = randomBytes(32).toString('hex');
  const credentialsKey: string =
    mode === 'mariadb' ? loadOrCreateServerKey(homedir()) : generateKey();
  const backendPort: number = await findFreePort();

  const running: { proxy?: Server; backend?: ChildProcess } = {};
  let stopping = false;
  const shutdown = (code: number): void => {
    if (stopping) return;
    stopping = true;
    running.proxy?.close();
    running.proxy?.closeAllConnections();
    if (running.backend && running.backend.exitCode === null) running.backend.kill('SIGTERM');
    process.exitCode = code;
    setTimeout(() => process.exit(code), 500).unref();
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  running.backend = startBackend({
    appDir: args.appDir,
    env: buildBackendEnv({ mode, backendPort, proxySecret, credentialsKey, mariadb }, process.env),
    onExit: (code: number) => {
      if (!stopping) process.stderr.write(`Backend exited with code ${code}\n`);
      shutdown(code);
    },
  });
  let port: number;
  try {
    await waitForPort({ port: backendPort, timeoutMs: BACKEND_START_TIMEOUT_MS, intervalMs: 200 });
    running.proxy = createProxy({ backendPort, secret: proxySecret });
    port = await listenOnFreePort(running.proxy, args.port);
  } catch (error) {
    shutdown(1);
    throw error;
  }
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(
    `\nHibiscus Frontend (${mode === 'demo' ? 'demo data' : 'MariaDB'}) is running at ${url}\n` +
      'Press Ctrl+C to stop.\n\n',
  );
  if (args.open) openBrowser(url);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
