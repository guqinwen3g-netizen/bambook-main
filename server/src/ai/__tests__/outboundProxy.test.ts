import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { aiFetch } from '../outboundProxy';

const servers: Server[] = [];
const sockets = new Set<Socket>();
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

it('preserves a real upstream401 and explicit Bearer header without browser credential negotiation', async () => {
  let requests = 0;
  let authorization: string | undefined;
  const upstream = createServer((req, res) => {
    requests++;
    authorization = req.headers.authorization;
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="synthetic"' });
    res.end(JSON.stringify({ error: 'synthetic expired access token' }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = createServer();
  proxy.on('connect', (request, client, head) => {
    sockets.add(client);
    expect(request.url).toBe('api.openai.com:80');
    const remote = connect(upstreamPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote); remote.pipe(client);
    });
    sockets.add(remote);
    remote.on('error', () => client.destroy());
    client.on('error', () => remote.destroy());
  });
  const port = await listen(proxy);
  vi.stubEnv('BAMBOOK_AI_HTTPS_PROXY', `http://127.0.0.1:${port}`);
  // A fake HTTP upstream behind a real CONNECT tunnel; no remote DNS, TLS bypass or real credentials.
  const response = await aiFetch('http://api.openai.com/availability', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-access-token' }, body: '{}',
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'synthetic expired access token' });
  expect(authorization).toBe('Bearer synthetic-access-token');
  expect(requests).toBe(1);
});
