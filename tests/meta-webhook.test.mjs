import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/crm_tungsten';
process.env.META_APP_SECRET = 'test-only-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-only-verify';
const { app } = await import('../apps/api/dist/app.js');

test('Meta validates challenges, signatures and payload shape before database access', async () => {
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const verified=await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=test-only-verify&hub.challenge=123`);
    assert.equal(verified.status,200);assert.equal(await verified.text(),'123');
    assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123`)).status,403);
    async function post(body,signature) {
      return fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json',...(signature?{'X-Hub-Signature-256':signature}:{})},body});
    }
    assert.equal((await post('{}')).status,403);
    assert.equal((await post('{}','sha256='+'0'.repeat(64))).status,403);
    const sign=body=>'sha256='+createHmac('sha256','test-only-secret').update(body).digest('hex');
    assert.equal((await post('{invalid',sign('{invalid'))).status,400);
    assert.equal((await post('{}',sign('{}'))).status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
