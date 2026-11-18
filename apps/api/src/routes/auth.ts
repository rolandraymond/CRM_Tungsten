import { Router } from 'express';
import { z } from 'zod';
import { consumeLoginAttempt, findSession, signIn, signOut } from '../lib/session-store.js';

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const login = z.strictObject({ email: z.email().trim().toLowerCase().max(320), password: z.string().min(1).max(1024) });
const bearer = (value: string | undefined) => value?.match(/^Bearer ([^\s]+)$/i)?.[1];

authRouter.post('/login', async (req, res) => {
  const parsed = login.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }); return; }
  try {
    if (!await consumeLoginAttempt(req.ip ?? req.socket.remoteAddress ?? 'unknown', parsed.data.email)) {
      res.setHeader('Retry-After', '900');
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Try again later' } }); return;
    }
    const session = await signIn(parsed.data.email, parsed.data.password);
    if (!session) { res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }); return; }
    res.json({ session });
  } catch {
    console.error('[Auth] Sign-in service failed');
    res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' } });
  }
});

authRouter.get('/session', async (req, res) => {
  const token = bearer(req.get('authorization'));
  if (!token) { res.status(401).json({ session: null }); return; }
  try {
    const session = await findSession(token);
    res.status(session ? 200 : 401).json({ session });
  } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' } }); }
});

authRouter.post('/logout', async (req, res) => {
  try {
    const token = bearer(req.get('authorization'));
    if (token) await signOut(token);
    res.sendStatus(204);
  } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' } }); }
});
