import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function archiveNonClinics() {
  await supabase
    .from('clinics')
    .update({ archived_at: new Date().toISOString() })
    .ilike('name', '%عميل فردي%');
  console.log('Archived non-clinic records');
}

archiveNonClinics().catch(console.error);
