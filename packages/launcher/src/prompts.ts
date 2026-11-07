import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import { parsePort, type LauncherMode } from './args';
import type { MariadbConnection } from './env';

class MutableOutput extends Writable {
  muted = false;

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error) => void): void {
    if (!this.muted) process.stdout.write(chunk);
    done();
  }
}

interface PendingAnswer {
  resolve(line: string): void;
  reject(error: Error): void;
}

function inputEndedError(): Error {
  return new Error('Input ended before all answers were given');
}

/**
 * Reads answers line by line. Lines are queued rather than read with `rl.question`: with piped
 * input every line arrives at once, and `question` only receives a line while it is waiting, so
 * the later answers would be lost.
 */
export class Prompter {
  private readonly output: MutableOutput = new MutableOutput();
  private readonly rl: Interface = createInterface({
    input: process.stdin,
    output: this.output,
    terminal: process.stdin.isTTY === true,
  });
  private readonly lines: string[] = [];
  private readonly waiting: PendingAnswer[] = [];
  private ended = false;

  constructor() {
    this.rl.on('line', (line: string) => {
      const pending: PendingAnswer | undefined = this.waiting.shift();
      if (pending === undefined) this.lines.push(line);
      else pending.resolve(line);
    });
    this.rl.on('close', () => {
      this.ended = true;
      for (const pending of this.waiting.splice(0)) pending.reject(inputEndedError());
    });
  }

  ask(question: string): Promise<string> {
    this.output.write(question);
    const queued: string | undefined = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.reject(inputEndedError());
    return new Promise<string>((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  async askHidden(question: string): Promise<string> {
    const pending: Promise<string> = this.ask(question);
    this.output.muted = true;
    try {
      return await pending;
    } finally {
      this.output.muted = false;
      process.stdout.write('\n');
    }
  }

  close(): void {
    this.rl.close();
  }
}

async function askRequired(prompter: Prompter, label: string, fallback?: string): Promise<string> {
  const suffix: string = fallback !== undefined ? ` [${fallback}]` : '';
  const answer: string = (await prompter.ask(`${label}${suffix}: `)).trim();
  const value: string = answer === '' && fallback !== undefined ? fallback : answer;
  if (value === '') throw new Error(`${label} is required`);
  return value;
}

export async function promptMode(prompter: Prompter): Promise<LauncherMode> {
  const answer: string = (
    await prompter.ask('[1] Demo data  [2] Connect to an existing MariaDB\nChoose (1/2): ')
  ).trim();
  if (answer === '1') return 'demo';
  if (answer === '2') return 'mariadb';
  throw new Error(`Invalid choice "${answer}", expected 1 or 2`);
}

export async function promptMariadb(prompter: Prompter): Promise<MariadbConnection> {
  const host: string = await askRequired(prompter, 'Host', '127.0.0.1');
  const port: number = parsePort(await askRequired(prompter, 'Port', '3306'), 'Port');
  const database: string = await askRequired(prompter, 'Database name');
  const user: string = await askRequired(prompter, 'User');
  const password: string = await prompter.askHidden('Password: ');
  if (password === '') throw new Error('Password is required');
  return { host, port, database, user, password };
}
