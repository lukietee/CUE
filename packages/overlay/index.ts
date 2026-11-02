import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type { OverlayMessage } from '../shared/index.ts';
import { overlayPage } from './page.ts';
const MessageSchema = z.object({
  type: z.enum(['SHOW_BANNER', 'HIDE_BANNER', 'SHOW_COUNTDOWN', 'SHOW_POLL', 'SHOW_RESULT']),
  text: z.string().max(600).optional(),
  mode: z.enum(['reality_tv', 'documentary', 'chill']).optional(),
  choices: z.array(z.string().max(100)).max(6).optional(),
  seconds: z.number().int().min(1).max(3600).optional(),
});
/** A read-only authenticated browser feed. Only in-process publish() controls overlays. */
export class OverlayServer {
  private token = randomBytes(32).toString('hex');
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private boundPort = 0;
  private revision = 0;
  private acknowledgedRevision = 0;
  private latest: OverlayMessage | null = null;
  constructor(private options: { port?: number } = {}) {}
  get url() {
    if (!this.boundPort) throw new Error('Overlay server has not started.');
    return `http://127.0.0.1:${this.boundPort}/?token=${this.token}`;
  }
  get state(): OverlayMessage | null {
    return this.latest ? structuredClone(this.latest) : null;
  }
  get verification() {
    return {
      revision: this.revision,
      acknowledgedRevision: this.acknowledgedRevision,
      clients: this.wss?.clients.size ?? 0,
    };
  }
  private authorized(rawUrl: string | undefined, host: string | undefined) {
    if (host !== `127.0.0.1:${this.boundPort}`) return false;
    try {
      const candidate = new URL(rawUrl ?? '/', 'http://127.0.0.1').searchParams.get('token') ?? '';
      return (
        candidate.length === this.token.length &&
        timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token))
      );
    } catch {
      return false;
    }
  }
  async start() {
    if (this.http) return;
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!this.authorized(req.url, req.headers.host)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end('Read-only overlay server');
        return;
      }
      if (new URL(req.url!, 'http://127.0.0.1').pathname !== '/') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(overlayPage);
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const origin = req.headers.origin;
      if (
        !this.authorized(req.url, req.headers.host) ||
        path !== '/ws' ||
        (origin && origin !== `http://127.0.0.1:${this.boundPort}`)
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws: WebSocket) => {
      ws.on('error', () => {});
      if (this.latest) ws.send(JSON.stringify({ revision: this.revision, message: this.latest }));
      ws.on('message', (data: Buffer) => {
        try {
          const ack = JSON.parse(data.toString()).ack;
          if (Number.isInteger(ack) && ack === this.revision) this.acknowledgedRevision = ack;
        } catch {}
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port ?? 4318, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    }).catch((error) => {
      wss.close();
      server.close();
      throw error;
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind overlay server.');
    this.boundPort = address.port;
    this.http = server;
    this.wss = wss;
  }
  async publish(message: OverlayMessage) {
    if (!this.http || !this.wss) throw new Error('Overlay server is not running.');
    this.latest = MessageSchema.parse(message);
    this.revision++;
    const packet = JSON.stringify({ revision: this.revision, message: this.latest });
    for (const client of this.wss.clients)
      if (client.readyState === WebSocket.OPEN) client.send(packet);
    return { revision: this.revision, clients: this.wss.clients.size };
  }
  async close() {
    const server = this.http;
    if (!server) return;
    for (const client of this.wss?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    this.http = null;
    this.wss = null;
    this.boundPort = 0;
  }
}
