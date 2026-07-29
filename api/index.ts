// Vercel serverless entry. All /api/* and /uploads/* traffic is routed here
// (see vercel.json). The full Express app from ../server.ts is built once per
// warm instance and reused; each cold start rebuilds and re-seeds it.
//
// Caveat: the backend keeps state in memory, so it does NOT persist across cold
// starts or between concurrent instances. This is a demo deployment only — a
// real deployment needs a persistent datastore (PRODUCTION-PASS.md #3), object
// storage for uploads (#4), and real auth (#1).
import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../server';

let appPromise: Promise<(req: IncomingMessage, res: ServerResponse) => void> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = createApp() as Promise<(req: IncomingMessage, res: ServerResponse) => void>;
  }
  const app = await appPromise;
  return app(req, res);
}
