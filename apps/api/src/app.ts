import express from 'express';
import { requireAuth } from './middleware/require-auth.js';
import { clinicsRouter } from './routes/clinics.js';
import { leadsRouter } from './modules/leads/leads.routes.js';
import { leadOptionsRouter } from './routes/lead-options.js';
import { adminRouter } from './routes/admin.js';
import { dashboardRouter } from './routes/dashboard.js';
import { metaWebhookRouter } from './features/chats/meta-webhook.routes.js';
import { chatsRouter } from './features/chats/chats.routes.js';
export const app = express();

app.disable('x-powered-by');

app.use('/webhook', (req, res, next) => {
  res.on('finish', () => {
    console.log('[Meta webhook]', {
      method: req.method,
      status: res.statusCode,
    });
  });

  next();
});

app.use(
  '/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  metaWebhookRouter,
);

app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'tungsten-crm-api',
  });
});

app.use('/clinics', clinicsRouter);
app.use('/leads', leadsRouter);
app.use('/lead-options', leadOptionsRouter);
app.use('/dashboard', dashboardRouter);
app.use('/admin', adminRouter);
app.use('/chats', chatsRouter);

app.get('/auth/me', requireAuth, (_req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    return;
  }

  res.json({
    user: {
      id: auth.userId,
      email: auth.email,
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
});
