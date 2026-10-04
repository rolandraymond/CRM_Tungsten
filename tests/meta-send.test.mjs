import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMetaText } from '../apps/api/dist/features/chats/meta-send.js';
const config = { token: 'test-only-token', endpoint_id: '12345' };
test('Messenger sends a RESPONSE with the scoped recipient and keeps the token out of the URL', async () => {
  const result = await sendMetaText(config, 'facebook', 'customer', 'hello', 'v26.0', async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v26.0/12345/messages');
    assert.equal(init.headers.Authorization, 'Bearer test-only-token');
    assert.deepEqual(JSON.parse(init.body), { recipient: { id: 'customer' }, message: { text: 'hello' }, messaging_type: 'RESPONSE' });
    return Response.json({ message_id: 'mid.1' });
  });
  assert.deepEqual(result, { status: 'sent', messageId: 'mid.1' });
});
test('Instagram Login uses its selected host without the Messenger-specific field', async () => {
  const result = await sendMetaText({ ...config, host: 'instagram' }, 'instagram', 'ig-customer', 'reply', 'v26.0', async (url, init) => {
    assert.match(url, /^https:\/\/graph.instagram.com\//);
    assert.equal(JSON.parse(init.body).messaging_type, undefined);
    return Response.json({ message_id: 'ig.1' });
  });
  assert.equal(result.status, 'sent');
});
test('invalid host/config never transmits credentials', async () => {
  let calls = 0;
  const result = await sendMetaText({ ...config, host: 'evil.example' }, 'instagram', 'x', 'reply', 'v26.0', async () => { calls++; });
  assert.equal(calls, 0); assert.equal(result.status, 'failed');
});
test('network failures and server errors are unknown, never claimed as sent', async () => {
  const network = await sendMetaText(config, 'facebook', 'x', 'reply', 'v26.0', async () => { throw new Error('timeout'); });
  assert.equal(network.status, 'unknown');
  const server = await sendMetaText(config, 'facebook', 'x', 'reply', 'v26.0', async () => Response.json({ error: { code: 2 } }, { status: 500 }));
  assert.equal(server.status, 'unknown');
});
test('Meta permission errors expose a safe code, not provider details or tokens', async () => {
  const result = await sendMetaText(config, 'facebook', 'x', 'reply', 'v26.0', async () => Response.json({ error: { code: 190, message: 'private details' } }, { status: 400 }));
  assert.deepEqual(result, { status: 'failed', code: 'META_190_0' });
});
