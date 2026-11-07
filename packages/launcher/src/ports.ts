import type { Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';

export const PORT_SEARCH_RANGE = 20;

/** Asks the OS for a free port on 127.0.0.1. */
export function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port: number = (probe.address() as AddressInfo).port;
      probe.close((error?: Error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function listenOnce(server: Server, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(true);
    });
  });
}

/** Listens on the first free port in [startPort, startPort + 20]; throws if none is free. */
export async function listenOnFreePort(server: Server, startPort: number): Promise<number> {
  for (let port: number = startPort; port <= startPort + PORT_SEARCH_RANGE; port++) {
    if (port > 65535) break;
    if (await listenOnce(server, port)) return port;
  }
  throw new Error(
    `No free port between ${startPort} and ${startPort + PORT_SEARCH_RANGE}. Use --port <n>.`,
  );
}
