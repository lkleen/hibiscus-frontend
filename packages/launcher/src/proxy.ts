import type { AddressInfo } from 'node:net';
import {
  request,
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { LOCAL_USER, SECRET_HEADER, USER_HEADER } from './env';

export interface ProxyParams {
  backendPort: number;
  secret: string;
}

/** Forward-auth stand-in: overwrites the identity headers, then streams to the backend. */
export function createProxy(params: ProxyParams): Server {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // The backend allows every CORS origin and this proxy injects the identity for every request,
    // so without these checks any website in the user's browser (or a DNS-rebinding host) could
    // read the user's data through 127.0.0.1. Only our own origin may talk to us.
    const port: number = (server.address() as AddressInfo).port;
    const hosts: string[] = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host: string | undefined = req.headers.host?.toLowerCase();
    if (host === undefined || !hosts.includes(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden: unexpected Host header');
      return;
    }
    const origin: string | undefined = req.headers.origin?.toLowerCase();
    if (origin !== undefined && !hosts.some((h: string) => origin === `http://${h}`)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden: cross-origin request');
      return;
    }
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    for (const name of Object.keys(headers)) {
      const lower: string = name.toLowerCase();
      if (lower === USER_HEADER.toLowerCase() || lower === SECRET_HEADER.toLowerCase()) {
        delete headers[name];
      }
    }
    headers[USER_HEADER.toLowerCase()] = LOCAL_USER;
    headers[SECRET_HEADER.toLowerCase()] = params.secret;

    const upstream = request(
      {
        host: '127.0.0.1',
        port: params.backendPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes: IncomingMessage) => {
        const responseHeaders: IncomingHttpHeaders = { ...upstreamRes.headers };
        for (const name of Object.keys(responseHeaders)) {
          if (name.toLowerCase().startsWith('access-control-allow-')) delete responseHeaders[name];
        }
        res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error: Error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Backend unreachable: ${error.message}`);
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  return server;
}
