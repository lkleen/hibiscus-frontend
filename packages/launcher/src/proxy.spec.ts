import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findFreePort, listenOnFreePort } from './ports';
import { createProxy } from './proxy';

interface Reply {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function send(port: number, headers: Record<string, string>, body: string): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'POST', agent: false, path: '/api/x?y=1', headers },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function startProxy(backendPort: number): Promise<number> {
  const proxy: Server = createProxy({ backendPort, secret: 'real-secret' });
  servers.push(proxy);
  return listenOnFreePort(proxy, 18080);
}

describe('createProxy', () => {
  it('overwrites forged identity headers and passes body and status through', async () => {
    let seen: IncomingHttpHeaders = {};
    let seenUrl: string | undefined;
    const backend: Server = createServer((req, res) => {
      seen = req.headers;
      seenUrl = req.url;
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        res.writeHead(201, { 'x-test': 'ok' });
        res.end(`echo:${body}`);
      });
    });
    servers.push(backend);
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
    const proxyPort: number = await startProxy((backend.address() as AddressInfo).port);

    const reply: Reply = await send(
      proxyPort,
      { 'X-Forwarded-User': 'evil@x', 'x-internal-auth-secret': 'forged', 'content-length': '5' },
      'hello',
    );

    expect(seen['x-forwarded-user']).toBe('local@localhost');
    expect(seen['x-internal-auth-secret']).toBe('real-secret');
    expect(seenUrl).toBe('/api/x?y=1');
    expect(reply).toMatchObject({ status: 201, body: 'echo:hello' });
  });

  it('answers 502 when the backend is down', async () => {
    const proxyPort: number = await startProxy(await findFreePort());
    const reply: Reply = await send(proxyPort, {}, '');
    expect(reply.status).toBe(502);
  });

  it('rejects foreign Host and Origin headers and strips CORS headers', async () => {
    let hits = 0;
    const backend: Server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'access-control-allow-origin': '*', 'x-keep': '1' });
      res.end('ok');
    });
    servers.push(backend);
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
    const proxyPort: number = await startProxy((backend.address() as AddressInfo).port);

    expect((await send(proxyPort, { host: 'evil.example' }, '')).status).toBe(403);
    expect((await send(proxyPort, { origin: 'https://evil.example' }, '')).status).toBe(403);
    expect(hits).toBe(0);

    const ok: Reply = await send(proxyPort, { origin: `http://localhost:${proxyPort}` }, '');
    expect(ok).toMatchObject({ status: 200, body: 'ok' });
    expect(hits).toBe(1);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
    expect(ok.headers['x-keep']).toBe('1');
  });
});
