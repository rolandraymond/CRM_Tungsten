import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'clinic123123@gmail.com',
    password: 'Tungsten@2026!'
  });

  if (error) {
    console.error('Sign in error:', error);
    return;
  }

  const token = data.session.access_token;

  // Test admin status
  const res = await fetch('http://localhost:3001/api/admin/status', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Status code:', res.status, await res.json());

  // Test clinics list
  const clinRes = await fetch('http://localhost:3001/api/clinics', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Clinics code:', clinRes.status, await clinRes.json());

  // Test dashboard
  const dashRes = await fetch('http://localhost:3001/api/dashboard?clinic_id=6dc2d43b-32f4-4764-adf8-d21c3b442f61', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Dashboard code:', dashRes.status, await dashRes.json());

  // Test through Vite proxy at 5173
  const viteRes = await fetch('http://localhost:5173/api/admin/status', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Vite proxy status code:', viteRes.status);
}

test().catch(console.error);
