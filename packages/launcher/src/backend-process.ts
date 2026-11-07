import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface StartBackendParams {
  appDir: string;
  env: Record<string, string>;
  onExit: (code: number) => void;
}

function pipeWithPrefix(stream: NodeJS.ReadableStream, target: NodeJS.WriteStream): void {
  createInterface({ input: stream }).on('line', (line: string) =>
    target.write(`[backend] ${line}\n`),
  );
}

export function startBackend(params: StartBackendParams): ChildProcess {
  const script: string = join(params.appDir, 'dist', 'server.js');
  if (!existsSync(script)) {
    throw new Error(`Backend not found at ${script}. Use --app-dir <dir> to point at the app.`);
  }
  const child: ChildProcess = spawn(process.execPath, [script], {
    cwd: params.appDir,
    env: params.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.stdout || !child.stderr) throw new Error('Backend output streams are unavailable');
  pipeWithPrefix(child.stdout, process.stdout);
  pipeWithPrefix(child.stderr, process.stderr);
  child.on('error', (error: Error) => {
    process.stderr.write(`Failed to start backend: ${error.message}\n`);
    params.onExit(1);
  });
  child.on('exit', (code: number | null) => params.onExit(code ?? 1));
  return child;
}

function canConnect(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export interface WaitForPortParams {
  port: number;
  timeoutMs: number;
  intervalMs: number;
}

export async function waitForPort(params: WaitForPortParams): Promise<void> {
  const deadline: number = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(params.port)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, params.intervalMs));
  }
  throw new Error(
    `Backend did not accept connections on port ${params.port} within ${params.timeoutMs / 1000} s. ` +
      'Check the [backend] output above (database reachable? credentials correct?).',
  );
}
