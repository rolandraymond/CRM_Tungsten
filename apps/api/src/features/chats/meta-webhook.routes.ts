import { Router } from 'express';
import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
export const metaWebhookRouter = Router();

function tokensMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

metaWebhookRouter.get('/', (req, res) => {
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (!expectedToken) {
    res.status(503).send('Webhook verification is not configured');
    return;
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode !== 'subscribe' ||
    typeof token !== 'string' ||
    typeof challenge !== 'string' ||
    !tokensMatch(token, expectedToken)
  ) {
    res.sendStatus(403);
    return;
  }

  res.status(200).type('text/plain').send(challenge);
});

metaWebhookRouter.post('/', async (req, res) => {
  const appSecret = process.env.META_APP_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!appSecret || !supabaseUrl || !serviceKey) {
    res.status(503).send('Webhook receiver is not configured');
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    res.status(400).send('Raw request body is required');
    return;
  }

const rawBody: Buffer = req.body;
const signature = req.get('x-hub-signature-256');

if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
  console.warn('[Meta webhook] Signature missing or malformed');
  res.sendStatus(403);
  return;
}

const receivedSignature = Buffer.from(signature.slice(7), 'hex');

const expectedSignature = createHmac('sha256', appSecret)
  .update(rawBody)
  .digest();

if (!timingSafeEqual(receivedSignature, expectedSignature)) {
  console.warn('[Meta webhook] Signature mismatch');
  res.sendStatus(403);
  return;
}

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('object' in payload) ||
    !['page', 'instagram'].includes(String(payload.object)) ||
    !('entry' in payload) ||
    !Array.isArray(payload.entry)
  ) {
    res.status(400).send('Unsupported webhook payload');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  try {
    const { error } = await supabase
      .from('meta_webhook_inbox')
      .insert({
        payload_hash: createHash('sha256')
          .update(rawBody)
          .digest('hex'),
        payload,
      });

    // PostgreSQL unique violation: this exact payload is already saved.
    if (error && error.code !== '23505') {
      console.error('Meta webhook storage failed:', error.code);
      res.sendStatus(500);
      return;
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch {
    console.error('Meta webhook storage request failed');
    res.sendStatus(500);
  }
});