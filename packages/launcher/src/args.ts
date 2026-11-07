import { join } from 'node:path';

export type LauncherMode = 'demo' | 'mariadb';

export interface LauncherArgs {
  mode: LauncherMode | undefined;
  port: number;
  appDir: string;
  open: boolean;
  help: boolean;
}

export const USAGE = `Usage: start [options]

Starts Hibiscus Frontend locally for testing (no Docker).

Options:
  --demo          Use the built-in demo data
  --mariadb       Connect to an existing Hibiscus MariaDB (asks for the connection details)
  --port <n>      Port to serve on (default 8080; the next free port is used if busy)
  --app-dir <dir> Directory containing dist/server.js (default: the release layout)
  --no-open       Do not open the browser
  --help          Show this help
`;

export const DEFAULT_PORT = 8080;

export function defaultAppDir(launcherDistDir: string): string {
  return join(launcherDistDir, '..', '..');
}

export function parsePort(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer, got "${value}"`);
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error(`${label} must be between 1 and 65535`);
  return port;
}

export function parseArgs(argv: string[], defaultDir: string): LauncherArgs {
  const args: LauncherArgs = {
    mode: undefined,
    port: DEFAULT_PORT,
    appDir: defaultDir,
    open: true,
    help: false,
  };
  const valueOf = (index: number, flag: string): string => {
    const value: string | undefined = argv[index];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg: string = argv[i] as string;
    switch (arg) {
      case '--demo':
      case '--mariadb': {
        const mode: LauncherMode = arg === '--demo' ? 'demo' : 'mariadb';
        if (args.mode !== undefined && args.mode !== mode) {
          throw new Error('--demo and --mariadb are mutually exclusive');
        }
        args.mode = mode;
        break;
      }
      case '--port':
        args.port = parsePort(valueOf(++i, arg), '--port');
        break;
      case '--app-dir':
        args.appDir = valueOf(++i, arg);
        break;
      case '--no-open':
        args.open = false;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument "${arg}"\n\n${USAGE}`);
    }
  }
  return args;
}
