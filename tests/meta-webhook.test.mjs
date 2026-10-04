import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY = 'test-only-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
process.env.META_APP_SECRET = 'test-only-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-only-verify';
const { app } = await import('../apps/api/dist/app.js');
test('webhook verifies challenge, rejects unsigned/mismatched messages, and saves valid events', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  let inserts = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:54321/')) {
      inserts++; const body = JSON.parse(init.body);
      assert.equal(body.payload.object, 'page'); assert.match(body.payload_hash, /^[a-f0-9]{64}$/);
      return new Response(null, { status: 201 });
    }
    return realFetch(input, init);
  };
  try {
    const verified = await realFetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=test-only-verify&hub.challenge=123`);
    assert.equal(verified.status, 200); assert.equal(await verified.text(), '123');
    assert.equal((await realFetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123`)).status, 403);
    const body = '{"object":"page","entry":[]}';
    const post = headers => realFetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}` })).status, 403);
    assert.equal(inserts, 0);
    const valid = await post({ 'X-Hub-Signature-256': `sha256=${createHmac('sha256', 'test-only-secret').update(body).digest('hex')}` });
    assert.equal(valid.status, 200); assert.equal(await valid.text(), 'EVENT_RECEIVED'); assert.equal(inserts, 1);
  } finally { globalThis.fetch = realFetch; await new Promise(resolve => server.close(resolve)); }
});
