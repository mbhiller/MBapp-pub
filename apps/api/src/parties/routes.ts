// Register HTTP routes for Parties.
// Adapt the "register" signature to your router/bootstrap shape.

import type { IncomingMessage, ServerResponse } from 'http';
import { createParty, addRole, searchParties, getParty } from './repo';

// A tiny router shim so this file is framework-agnostic.
// Replace with your real router's registration (e.g., app.post('/parties', ...))
type Handler = (req: any, res: any) => Promise<void> | void;
export interface Router {
  get: (path: string, h: Handler) => void;
  post: (path: string, h: Handler) => void;
}

function json(res: ServerResponse, code: number, body: any) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Minimal body/params readers; swap with your real framework (APIGW wrapper, etc.)
async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function registerPartyRoutes(app: Router) {
  // POST /parties
  app.post('/parties', async (req, res) => {
    const body = await readBody(req);
    if (!body?.kind || !body?.name) return json(res, 400, { message: 'kind and name required' });
    const p = await createParty({ kind: body.kind, name: body.name });
    return json(res, 200, p);
  });

  // POST /parties/:id/roles
  app.post('/parties/:id/roles', async (req: any, res: any) => {
    const id = req.params?.id ?? req.path?.split('/')[2]; // adapt to your router param shape
    const body = await readBody(req);
    if (!id || !body?.role) return json(res, 400, { message: 'id and role required' });
    const updated = await addRole(id, body.role);
    if (!updated) return json(res, 404, { message: 'party not found' });
    return json(res, 200, updated);
  });

  // GET /parties?role=&q=
  app.get('/parties/:id', async (req: any, res: any) => {
    const id = req.params?.id ?? req.path?.split('/')[2];
    const row = await getParty(id);
    if (!row) return json(res, 404, { message: 'party not found' });
    return json(res, 200, row);
    });
}
