import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const enabled = process.env.NATIVE_INTEGRATION_TEST === 'true';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));

test('native PostgreSQL application integration', { skip: !enabled }, async t => {
  const { Client } = requireApi('pg');
  const bcrypt = requireApi('bcryptjs');
  const adminUrl = process.env.NATIVE_TEST_ADMIN_URL;
  assert.ok(adminUrl && ['127.0.0.1','localhost'].includes(new URL(adminUrl).hostname), 'Tests require the local disposable cluster');
  const url = new URL(adminUrl); url.pathname = '/crm_tungsten';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_setting('crm.test_only',true) AS flag")).rows[0].flag, 'true', 'Never run integration fixtures on a live database');
  const { app } = await import('../apps/api/dist/app.js');
  const { closeDatabase, getPool } = await import('../apps/api/dist/lib/postgres.js');
  const { createUserDatabaseClient, getDatabaseAdmin } = await import('../apps/api/dist/lib/database.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = { admin: randomUUID(), a: randomUUID(), b: randomUUID(), clinic: randomUUID() };
  const workspaces = { a: randomUUID(), b: randomUUID() };
  const fixturePassword = 'Native-test-password-2026!';
  const hash = await bcrypt.hash(fixturePassword, 10);
  const originals = (await admin.query('SELECT id, encrypted_password FROM auth.users ORDER BY id')).rows;
  const known = [];
  let browser;
  const realFetch = globalThis.fetch;

  async function request(path, token, method='GET', body, extra={}) {
    const response = await realFetch(base+path, { method, headers: {
      ...(token ? {Authorization:`Bearer ${token}`} : {}),
      ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...extra,
    }, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    const text = await response.text();
    let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return { status:response.status, body:payload };
  }
  async function login(name, password=fixturePassword) {
    const result = await request('/api/auth/login',null,'POST',{email:`native-${name}@example.invalid`,password});
    assert.equal(result.status,200,`Sign-in failed (${result.body?.error?.code})`);
    return result.body.session.access_token;
  }
  function ok(result) { assert.equal(result.error,null,result.error?.message); return result.data; }

  try {
    await admin.query('BEGIN');
    for (const [name,id] of Object.entries(users)) await admin.query(`INSERT INTO auth.users
      (id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES($1,'authenticated','authenticated',$2,$3,now(),$4,'{"provider":"email"}',now(),now(),false,false)`,
    [id,`native-${name}@example.invalid`,hash,JSON.stringify({full_name:`Native fixture ${name}`})]);
    await admin.query('INSERT INTO private.platform_admins(user_id) VALUES($1)',[users.admin]);
    await admin.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:users.admin,role:'authenticated'})]);
    for (const name of ['a','b']) {
      await admin.query("INSERT INTO public.crm_workspaces(id,name,workspace_type) VALUES($1,$2,'client_company')",[workspaces[name],`Native fixture ${name}`]);
      await admin.query("INSERT INTO public.crm_workspace_members(workspace_id,user_id,role) VALUES($1,$2,'company_owner')",[workspaces[name],users[name]]);
    }
    const clinicService = (await admin.query('SELECT clinic_id,service_id FROM public.clinic_services WHERE is_active ORDER BY clinic_id LIMIT 1')).rows[0];
    assert.ok(clinicService,'Source clinic/service fixture required');
    await admin.query("INSERT INTO public.clinic_memberships(clinic_id,user_id,role,is_active) VALUES($1,$2,'moderator',true)",[clinicService.clinic_id,users.clinic]);
    await admin.query('COMMIT');
    const tokens = {admin:await login('admin'),a:await login('a'),b:await login('b'),clinic:await login('clinic')};
    const a = createUserDatabaseClient(tokens.a), b = createUserDatabaseClient(tokens.b);
    const owner = createUserDatabaseClient(tokens.admin);

    await t.test('session persists, returns only public user fields, and rejects old Supabase tokens',async()=>{
      const session=await request('/api/auth/session',tokens.a);
      assert.equal(session.status,200); assert.equal(session.body.session.user.id,users.a);
      assert.equal(JSON.stringify(session.body).includes('encrypted_password'),false);
      assert.equal((await request('/api/auth/session','eyJ.legacy.jwt')).status,401);
      assert.equal((await request('/api/auth/me')).status,401);
      assert.equal((await request('/api/auth/me',tokens.a)).body.user.id,users.a);
      assert.equal((await request('/api/auth/login',null,'POST',{email:'native-a@example.invalid',password:'incorrect'})).status,401);
    });

    await t.test('runtime login has no direct table privileges or owner membership',async()=>{
      const direct = await getPool().query("SELECT pg_has_role(current_user,'crm_tungsten_owner','MEMBER') AS owner, has_table_privilege(current_user,'public.crm_contacts','SELECT') AS read");
      assert.equal(direct.rows[0].owner,false); assert.equal(direct.rows[0].read,false);
    });

    await t.test('workspace lists are scoped to the signed-in identity',async()=>{
      const result=await request('/api/crm/workspaces',tokens.a);
      assert.equal(result.status,200); assert.deepEqual(result.body.workspaces.map(w=>w.id),[workspaces.a]);
      assert.equal(ok(await a.rpc('crm_admin_status')),false);
      assert.equal(ok(await owner.rpc('crm_admin_status')),true);
    });

    let contact;
    await t.test('native HTTP creates real CRM records, without fabricated approved plans',async()=>{
      const response=await request(`/api/crm/workspaces/${workspaces.a}/contacts`,tokens.a,'POST',{
        full_name:'Native real input',phone_number:'+201099991111',lead_id:'NATIVE-INPUT-1',business_name:'',
      });
      assert.equal(response.status,201,response.body?.error);
      contact=response.body.data; known.push(contact.id);
      assert.equal(contact.created_by,users.a); assert.equal(contact.contact_owner_id,users.a);
      const detail=await request(`/api/crm/workspaces/${workspaces.a}/contacts/${contact.id}`,tokens.a);
      assert.equal(detail.status,200,detail.body?.error); assert.equal(detail.body.data.plan_details,null);
      assert.deepEqual(detail.body.data.deals,[]);
    });

    await t.test('cross-tenant reads and writes fail under PostgreSQL RLS',async()=>{
      assert.deepEqual(ok(await b.from('crm_contacts').select('*').eq('id',contact.id)),[]);
      const attempt=await b.from('crm_contacts').update({full_name:'unauthorized'}).eq('id',contact.id).select().maybeSingle();
      assert.equal(attempt.data,null); assert.equal(attempt.error,null);
      assert.equal(ok(await a.from('crm_contacts').select('full_name').eq('id',contact.id).single()).full_name,'Native real input');
      assert.equal((await request(`/api/crm/workspaces/${workspaces.a}/contacts/${contact.id}`,tokens.b)).status,404);
    });

    await t.test('query filters are parameterized, and exact count/head/range behave correctly',async()=>{
      const needle="x' OR true --";
      const injected=await a.from('crm_contacts').select('id',{count:'exact'}).eq('full_name',needle);
      assert.deepEqual(ok(injected),[]); assert.equal(injected.count,0);
      const searched=await a.from('crm_contacts').select('id',{count:'exact'}).or('full_name.ilike.%real%,phone_number.ilike.%missing%').order('created_at').range(0,0);
      assert.equal(ok(searched).length,1); assert.equal(searched.count,1);
      const head=await a.from('crm_contacts').select('id',{count:'exact',head:true});
      assert.equal(head.error,null); assert.equal(head.data,null); assert.equal(head.count,1);
      const invalid=await a.from('crm_contacts').select('id').eq('id;DROP_TABLE',contact.id);
      assert.ok(invalid.error);
    });

    await t.test('updates, upserts, composite foreign-key embeds and inverse embeds work',async()=>{
      const company=ok(await a.from('crm_companies').insert({workspace_id:workspaces.a,company_name:'Native company',company_owner_id:users.a}).select().single());
      ok(await a.from('crm_contacts').update({company_id:company.id}).eq('id',contact.id));
      const deal=ok(await a.from('crm_deals').insert({workspace_id:workspaces.a,deal_name:'Explicit proposal',deal_owner_id:users.a,deal_amount:1250,company_id:company.id}).select().single());
      ok(await a.from('crm_deal_contacts').upsert({workspace_id:workspaces.a,deal_id:deal.id,contact_id:contact.id},{onConflict:'deal_id,contact_id',ignoreDuplicates:true}));
      const duplicate=await getDatabaseAdmin().from('crm_deal_contacts').upsert({workspace_id:workspaces.a,deal_id:deal.id,contact_id:contact.id},{onConflict:'deal_id,contact_id'}).select().single();
      assert.equal(duplicate.error,null,duplicate.error?.message);
      const nested=ok(await a.from('crm_deals').select('*,crm_companies(company_name),crm_deal_contacts(contact_id,crm_contacts(full_name))').eq('id',deal.id).single());
      assert.equal(nested.crm_companies.company_name,'Native company');
      assert.equal(nested.crm_deal_contacts[0].crm_contacts.full_name,'Native real input');
      const services=ok(await getDatabaseAdmin().from('clinic_services').select('service_id,service:services!inner(service_name,is_active)').eq('service.is_active',true));
      assert.ok(services.length>0); assert.ok(services.every(row=>row.service.is_active));
      const appointments=await getDatabaseAdmin().from('appointments').select('id,lead:leads!appointments_lead_same_clinic_fk(requested_service_name_snapshot,contact:contacts(full_name,phone))').limit(0);
      assert.equal(appointments.error,null,appointments.error?.message);
    });

    await t.test('concurrent pooled queries never retain another identity',async()=>{
      await Promise.all(Array.from({length:40},async(_,index)=>{
        const result=await (index%2 ? a:b).from('crm_contacts').select('id');
        assert.equal(result.error,null,result.error?.message);
        assert.equal(result.data.length,index%2?1:0);
      }));
      const leaked=await getPool().query("SELECT current_user AS role,current_setting('request.jwt.claims',true) AS claims");
      assert.equal(leaked.rows[0].role,'crm_tungsten_app'); assert.ok(!leaked.rows[0].claims || leaked.rows[0].claims==='');
    });

    await t.test('legacy clinic RPC creates a lead atomically and preserves idempotent retries',async()=>{
      const staff=createUserDatabaseClient(tokens.clinic);
      const args={p_request_id:randomUUID(),p_clinic_id:clinicService.clinic_id,p_full_name:'Native clinic fixture',p_phone:'+201099991234',p_requested_service_id:clinicService.service_id,p_source:'other',p_attribution_status:'not_applicable'};
      const first=await staff.rpc('create_lead',args); assert.equal(first.error,null,first.error?.message);
      const again=await staff.rpc('create_lead',args); assert.equal(again.error,null,again.error?.message);
      assert.equal(first.data.lead_id,again.data.lead_id); assert.equal(first.data.replayed,false); assert.equal(again.data.replayed,true);
      const denied=await a.rpc('create_lead',{...args,p_request_id:randomUUID()}); assert.equal(denied.error?.code,'42501');
    });

    await t.test('company owner cannot provision global accounts before authorization',async()=>{
      const email='must-not-exist@example.invalid';
      const result=await request('/api/crm/workspaces/provision',tokens.a,'POST',{name:'Forbidden',initialOwnerEmail:email,initialOwnerPassword:'Not-created-password-2026!'});
      assert.equal(result.status,403);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM auth.users WHERE email=$1',[email])).rows[0].n,0);
    });

    await t.test('authorized account creation hashes passwords and makes a usable native account',async()=>{
      const result=await request('/api/admin/team/users',tokens.admin,'POST',{full_name:'Native created user',email:'native-created@example.invalid',password:fixturePassword});
      assert.equal(result.status,201,JSON.stringify(result.body));
      const user=(await admin.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[result.body.data.id])).rows[0];
      assert.ok(await bcrypt.compare(fixturePassword,user.encrypted_password));
      const created=await login('created'); assert.ok(created);
      const forbidden=await request('/api/admin/team/users',tokens.a,'POST',{full_name:'Forbidden',email:'forbidden@example.invalid',password:fixturePassword});
      assert.equal(forbidden.status,403);
    });

    await t.test('Meta webhook rejects bad signatures and stores one copy of a valid event',async()=>{
      const body=JSON.stringify({object:'page',entry:[]});
      const digest=createHash('sha256').update(body).digest('hex');
      const post=signature=>realFetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json',...(signature?{'x-hub-signature-256':signature}:{})},body});
      assert.equal((await post()).status,403);
      assert.equal((await post('sha256='+'0'.repeat(64))).status,403);
      const signature='sha256='+createHmac('sha256',process.env.META_APP_SECRET).update(body).digest('hex');
      assert.equal((await post(signature)).status,200); assert.equal((await post(signature)).status,200);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.meta_webhook_inbox WHERE payload_hash=$1',[digest])).rows[0].n,1);
    });

    await t.test('SocialLens receiver and logs enforce authentication and workspace ownership',async()=>{
      assert.equal((await request('/webhook/sociallens',null,'POST',{})).status,503);
      process.env.SOCIALLENS_WEBHOOK_SECRET='test-only-sociallens-secret';
      assert.equal((await request('/webhook/sociallens',null,'POST',{})).status,403);
      assert.equal((await request('/webhook/sociallens/logs?workspace_id='+workspaces.a)).status,401);
      assert.equal((await request('/webhook/sociallens/logs?workspace_id='+workspaces.a,tokens.b)).status,403);
      ok(await a.from('crm_workspace_members').select('role').eq('workspace_id',workspaces.a).eq('user_id',users.a).eq('is_active',true).maybeSingle());
      assert.ok(ok(await a.from('crm_workspaces').select('workspace_type').eq('id',workspaces.a).maybeSingle()));
      assert.equal((await request('/webhook/sociallens/logs?workspace_id='+workspaces.a,tokens.a)).status,200);
      const result=await request('/api/crm/webhooks/sociallens?workspace_id='+workspaces.a,tokens.b,'POST',{name:'Forbidden'});
      assert.equal(result.status,403);
      const received=await request('/webhook/sociallens?workspace_id='+workspaces.a,null,'POST',{
        event:'lead.created',lead_id:'NATIVE-SOCIALLENS',full_name:'Actual external input',phone:'+201099995555',sales_email:'native-a@example.invalid',
      },{'x-webhook-secret':process.env.SOCIALLENS_WEBHOOK_SECRET});
      assert.equal(received.status,200,JSON.stringify(received.body));
      const imported=ok(await a.from('crm_contacts').select('*').eq('id',received.body.data.contact_id).single());
      assert.equal(imported.created_by,users.a);assert.equal(imported.contact_owner_id,users.a);assert.equal(received.body.data.plan_details,null);
      const replay=await request('/webhook/sociallens?workspace_id='+workspaces.a,null,'POST',{
        lead_id:'NATIVE-SOCIALLENS',full_name:'Actual external input',phone:'+201099995555',sales_email:'native-a@example.invalid',
      },{'x-webhook-secret':process.env.SOCIALLENS_WEBHOOK_SECRET});
      assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.data.contact_id,imported.id);
    });

    await t.test('browser auth client validates a persisted session after reload and clears revoked sessions',async()=>{
      const {transform}=requireApi('esbuild');
      const storage=new Map();const events=new EventTarget();
      globalThis.window={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},addEventListener:events.addEventListener.bind(events)};
      globalThis.fetch=(input,init)=>realFetch(new URL(input,base),init);
      const code=await transform(await readFile(new URL('../apps/web/src/lib/auth-client.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm',target:'es2022'});
      browser=await import('data:text/javascript;base64,'+Buffer.from(code.code).toString('base64'));
      const signedIn=await browser.authClient.auth.signInWithPassword({email:'native-a@example.invalid',password:fixturePassword});
      assert.equal(signedIn.error,null);assert.equal(storage.size,1);
      assert.equal((await browser.authClient.auth.getSession()).data.session.user.id,users.a);
      await request('/api/auth/logout',signedIn.data.session.access_token,'POST');
      assert.equal((await browser.authClient.auth.getSession()).data.session,null);assert.equal(storage.size,0);
    });

    await t.test('expired sessions and password changes invalidate previously issued tokens',async()=>{
      const expired=await login('a');
      await admin.query("UPDATE private.native_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[createHash('sha256').update(expired).digest('hex')]);
      assert.equal((await request('/api/auth/session',expired)).status,401);
      const changed=await login('b');
      await admin.query('UPDATE auth.users SET encrypted_password=$1 WHERE id=$2',[await bcrypt.hash('Changed-password-2026!',10),users.b]);
      assert.equal((await request('/api/auth/session',changed)).status,401);
      await request('/api/auth/logout',tokens.a,'POST');
      assert.equal((await request('/api/auth/session',tokens.a)).status,401);
    });

    await t.test('rate limiting is persisted in PostgreSQL and original password hashes remain unchanged',async()=>{
      let last;
      for(let i=0;i<16;i++) last=await request('/api/auth/login',null,'POST',{email:'missing-rate-limit@example.invalid',password:'incorrect'});
      assert.equal(last.status,429);
      for(const original of originals) assert.equal((await admin.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[original.id])).rows[0].encrypted_password,original.encrypted_password);
    });
  } finally {
    browser?.clearInvalidSession();
    globalThis.fetch=realFetch;
    await new Promise(resolve=>server.close(resolve));
    await closeDatabase();
    await admin.end();
  }
});
