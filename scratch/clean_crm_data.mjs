import { getSupabaseAdmin } from '../apps/api/dist/lib/supabase.js';

async function cleanup() {
  const admin = getSupabaseAdmin();

  // 1. Update contacts
  const updates = [
    { lead_id: 'SL-11', full_name: 'سات 7', medical_specialty: null, business_name: 'متجر سات 7 الإلكتروني', job_title: 'تجارة إلكترونية' },
    { lead_id: 'SL-12', full_name: 'qqqqqq', medical_specialty: null, business_name: 'براند شخصي', job_title: 'علامة شخصية (Personal Brand)' },
    { lead_id: 'SL-13', full_name: 'مارتن عماد', medical_specialty: null, business_name: 'براند شخصي', job_title: 'علامة شخصية (Personal Brand)' },
    { lead_id: 'SL-1', full_name: 'peter', medical_specialty: 'عيادة طبية', business_name: 'عيادة د. بيتر الطبية', job_title: 'طبيب' },
    { lead_id: 'SL-2', full_name: 'dsidh', medical_specialty: null, business_name: 'شركة dsidh التجارية', job_title: 'شركة تجارية' },
    { lead_id: 'SL-3', full_name: 'fhjged', medical_specialty: null, business_name: 'مؤسسة fhjged التجارية', job_title: 'شركة تجارية' },
    { lead_id: 'SL-4', full_name: 'Osama Shawki', medical_specialty: null, business_name: 'شركة Osama Shawki', job_title: 'شركة تجارية' },
    { lead_id: 'SL-5', full_name: 'ىلااتبغع', medical_specialty: null, business_name: 'شركة ىلااتبغع التجارية', job_title: 'شركة تجارية' },
    { lead_id: 'SL-14', full_name: 'غغ', medical_specialty: null, business_name: 'شركة غغ التجارية', job_title: 'شركة تجارية' },
    { lead_id: 'SL-15', full_name: '[d]', medical_specialty: null, business_name: 'شركة [d] التجارية', job_title: 'شركة تجارية' },
  ];

  for (const u of updates) {
    const { error } = await admin
      .from('crm_contacts')
      .update({
        medical_specialty: u.medical_specialty,
        business_name: u.business_name,
        job_title: u.job_title,
        updated_at: new Date().toISOString()
      })
      .eq('lead_id', u.lead_id);

    console.log(`Updated contact ${u.lead_id} (${u.full_name}):`, error ? error.message : 'OK');
  }

  // 2. Update non-won deals to stage 'زيارة' (as requested: "خلي اي ليد ييجي من السوشيال لينس يبقي الحاله تمت الزياره عادي")
  const nonWonDeals = [
    'باقة Tungsten Enterprise - peter',
    'باقة Tungsten Enterprise - dsidh',
    'باقة Tungsten Enterprise - fhjged',
    'باقة Tungsten Enterprise - ىلااتبغع',
    'باقة Tungsten Enterprise - سات 7',
    'باقة Tungsten Enterprise - مارتن عماد',
    'باقة Tungsten Enterprise - []d]',
    'باقة Tungsten Enterprise - [d]'
  ];

  for (const dealName of nonWonDeals) {
    const { error } = await admin
      .from('crm_deals')
      .update({
        deal_stage: 'زيارة',
        updated_at: new Date().toISOString()
      })
      .ilike('deal_name', `%${dealName}%`)
      .neq('deal_stage', 'عميل');

    console.log(`Updated deal stage to 'زيارة' for ${dealName}:`, error ? error.message : 'OK');
  }

  console.log('Cleanup completed successfully.');
}

cleanup().catch(console.error);
