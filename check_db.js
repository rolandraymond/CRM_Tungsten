const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'apps/api/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: clinics, error: errC } = await supabase.from('clinics').select('id, name, slug');
  console.log('Clinics:', JSON.stringify(clinics, null, 2));

  const { data: members, error: errM } = await supabase.from('clinic_memberships').select('id, user_id, clinic_id, role, clinics(name)');
  console.log('Clinic Memberships:', JSON.stringify(members, null, 2));

  const { data: crmMembers, error: errCM } = await supabase.from('crm_workspace_members').select('id, user_id, role, workspace_id');
  console.log('CRM Workspace Members:', JSON.stringify(crmMembers, null, 2));

  const { data: users, error: errU } = await supabase.auth.admin.listUsers();
  console.log('Users:', users?.users?.map(u => ({ id: u.id, email: u.email })));

  const { data: services, error: errS } = await supabase.from('services').select('id, name');
  console.log('Services:', JSON.stringify(services, null, 2));

  const { data: clinicServices, error: errCS } = await supabase.from('clinic_services').select('id, clinic_id, service_id, is_active');
  console.log('Clinic Services:', JSON.stringify(clinicServices, null, 2));

  const { data: ads, error: errA } = await supabase.from('clinic_ads').select('id, clinic_id, name, is_active');
  console.log('Clinic Ads:', JSON.stringify(ads, null, 2));
}

check().catch(console.error);
