import express from 'express';
import { requireAuth } from './middleware/require-auth.js';
import { clinicsRouter } from './routes/clinics.js';
import { leadsRouter } from './modules/leads/leads.routes.js';
import { leadOptionsRouter } from './routes/lead-options.js';
import { adminRouter } from './routes/admin.js';
import { dashboardRouter } from './routes/dashboard.js';
import { metaWebhookRouter } from './features/chats/meta-webhook.routes.js';
import { chatsRouter } from './features/chats/chats.routes.js';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { bookingSettingsRouter } from './routes/booking-settings.js';
import { bookingAvailabilityRouter } from './routes/booking-availability.js';
import { bookingFollowUpRouter } from './routes/booking-follow-up.js';
import { bookingFollowUpBoardRouter } from './routes/booking-follow-up-board.js';
export const app = express();
const apiRouter = express.Router();

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

apiRouter.use('/clinics', clinicsRouter);
apiRouter.use('/booking-settings', bookingSettingsRouter);
apiRouter.use('/booking-availability', bookingAvailabilityRouter);
apiRouter.use('/booking-follow-up', bookingFollowUpRouter);
apiRouter.use('/booking-follow-up-board', bookingFollowUpBoardRouter);
apiRouter.use('/leads', leadsRouter);
apiRouter.use('/lead-options', leadOptionsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/chats', chatsRouter);

apiRouter.get('/auth/me', requireAuth, (_req, res) => {
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

app.use('/api', apiRouter);

// Unknown API endpoints must return JSON, not the React page.
app.use('/api', (_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'API route not found',
    },
  });
});

if (process.env.NODE_ENV === 'production') {
  const webDist = fileURLToPath(
    new URL('../../web/dist/', import.meta.url),
  );

  app.use(express.static(webDist, { index: false }));

  app.get('/{*path}', (req, res, next) => {
    if (
      req.path === '/webhook' ||
      req.path.startsWith('/webhook/') ||
      extname(req.path) ||
      !req.accepts('html')
    ) {
      next();
      return;
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: webDist });
  });
}

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
});
