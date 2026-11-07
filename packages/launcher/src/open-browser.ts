import { spawn } from 'node:child_process';

export interface OpenCommand {
  command: string;
  args: string[];
}

export function openCommand(url: string, platform: NodeJS.Platform): OpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url] };
  return { command: 'xdg-open', args: [url] };
}

/** Failure to open only prints the URL; it never stops the launcher. */
export function openBrowser(url: string): void {
  const { command, args }: OpenCommand = openCommand(url, process.platform);
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => process.stdout.write(`Could not open a browser. Open ${url}\n`));
    child.unref();
  } catch {
    process.stdout.write(`Could not open a browser. Open ${url}\n`);
  }
}
