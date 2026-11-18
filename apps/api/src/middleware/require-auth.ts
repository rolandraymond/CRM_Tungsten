import type { RequestHandler } from 'express';
import { findSession } from '../lib/session-store.js';
import { requestContext } from '../lib/request-context.js';

declare module 'express-serve-static-core' {
  interface Locals { auth?: { userId: string; email: string | null; accessToken: string }; }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = req.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A Bearer access token is required' } }); return; }
  try {
    const session = await findSession(token);
    if (!session) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired session' } }); return; }
    res.locals.auth = { userId: session.user.id, email: session.user.email ?? null, accessToken: token };
    requestContext.run({ user: session.user, accessToken: token }, () => next());
  } catch {
    res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication service is temporarily unavailable' } });
  }
};
