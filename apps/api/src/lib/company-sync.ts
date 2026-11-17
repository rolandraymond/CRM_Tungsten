import { SupabaseClient } from '@supabase/supabase-js';
import { ensureClinicSynced } from './clinic-sync.js';

export type EntityClassification = {
  entityType: 'clinic' | 'brand' | 'company';
  industry: 'عيادة طبية' | 'براند شخصي' | 'شركة تجارية';
  categoryLabel: string;
  defaultPrefix: string;
};

/**
 * Classifies any contact into one of the 3 primary CRM entities:
 * 1. عيادة / دكتور (Clinic / Doctor)
 * 2. براند شخصي (Personal Brand)
 * 3. شركة تجارية (Commercial Company / Business)
 */
export function classifyContactEntityType(contact: {
  medical_specialty?: string | null;
  business_name?: string | null;
  job_title?: string | null;
  business_type?: string | null;
  business_activity?: string | null;
  category?: string | null;
}): EntityClassification {
  const combined = [
    contact.medical_specialty || '',
    contact.business_name || '',
    contact.job_title || '',
    contact.business_type || '',
    contact.business_activity || '',
    contact.category || '',
  ].join(' ').toLowerCase();

  // 1. Check if Clinic / Doctor
  const isClinicDoctor =
    Boolean(
      contact.medical_specialty &&
      !contact.medical_specialty.includes('شخصي') &&
      !contact.medical_specialty.includes('شركة') &&
      !contact.medical_specialty.includes('تجارة')
    ) ||
    combined.includes('عياد') ||
    combined.includes('طبيب') ||
    combined.includes('دكتور') ||
    combined.includes('مركز طبي') ||
    combined.includes('مستشفى') ||
    combined.includes('أسنان') ||
    combined.includes('جلدية') ||
    combined.includes('تجميل') ||
    combined.includes('clinic') ||
    combined.includes('doctor');

  if (isClinicDoctor) {
    return {
      entityType: 'clinic',
      industry: 'عيادة طبية',
      categoryLabel: 'عيادة / دكتور',
      defaultPrefix: 'عيادة د. ',
    };
  }

  // 2. Check if Personal Brand
  const isPersonalBrand =
    combined.includes('براند شخصي') ||
    combined.includes('علامة شخصية') ||
    combined.includes('صانع محتوى') ||
    combined.includes('صانع') ||
    combined.includes('محتوى') ||
    combined.includes('بلوجر') ||
    combined.includes('انفلونسر') ||
    combined.includes('شخصي') ||
    combined.includes('creator') ||
    combined.includes('personal_brand') ||
    combined.includes('brand') ||
    combined.includes('influencer');

  if (isPersonalBrand) {
    return {
      entityType: 'brand',
      industry: 'براند شخصي',
      categoryLabel: 'براند شخصي',
      defaultPrefix: 'براند ',
    };
  }

  // 3. Default: Commercial Company / Enterprise
  return {
    entityType: 'company',
    industry: 'شركة تجارية',
    categoryLabel: 'شركة تجارية',
    defaultPrefix: 'شركة ',
  };
}

/**
 * When a lead or person is converted to a client (Won deal, active customer, etc.),
 * this automatically classifies them into one of the 3 categories:
 * - براند شخصي
 * - شركة تجارية
 * - عيادة / دكتور
 * And ensures they are added to the "الشركات والعيادات" (crm_companies) page
 * and linked to the contact and associated deals.
 */
export async function ensureCompanyForConvertedClient(
  client: SupabaseClient,
  contactId: string,
  workspaceId: string,
  matchedUserId?: string | null
): Promise<string | null> {
  try {
    const { data: contact, error: contErr } = await client
      .from('crm_contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (contErr || !contact) {
      console.warn('[CompanySync] Contact not found for conversion:', contactId);
      return null;
    }

    // Check if contact already has a valid company linked
    if (contact.company_id) {
      const { data: existingComp } = await client
        .from('crm_companies')
        .select('id, company_name, industry')
        .eq('id', contact.company_id)
        .maybeSingle();

      if (existingComp) {
        // Already linked, ensure deals are also linked
        await client
          .from('crm_deals')
          .update({ company_id: existingComp.id })
          .eq('workspace_id', workspaceId)
          .is('company_id', null);

        return existingComp.id;
      }
    }

    // 1. Classify the contact
    const classification = classifyContactEntityType({
      medical_specialty: contact.medical_specialty,
      business_name: contact.business_name,
      job_title: contact.job_title,
    });

    const candidateName = (contact.business_name && contact.business_name.trim().length > 1)
      ? contact.business_name.trim()
      : `${classification.defaultPrefix}${contact.full_name || 'عميل'}`;

    // 2. Check if company with exact same name already exists in workspace
    const { data: existingCompByName } = await client
      .from('crm_companies')
      .select('id, company_name, industry')
      .eq('workspace_id', workspaceId)
      .ilike('company_name', candidateName)
      .limit(1)
      .maybeSingle();

    let targetCompanyId = existingCompByName?.id;

    if (!targetCompanyId) {
      const effectiveOwner = contact.contact_owner_id || contact.created_by || matchedUserId || 'b12ebe74-0136-4a2b-a1ad-8327826b7d61';
      const insertData = {
        workspace_id: workspaceId,
        company_name: candidateName,
        industry: classification.industry,
        city: contact.city || 'القاهرة',
        address: contact.clinic_address || null,
        phone: contact.phone_number || contact.whatsapp_number || null,
        website: contact.website || (contact.social_profile_link !== '-' ? contact.social_profile_link : null),
        company_owner_id: effectiveOwner,
        created_by: effectiveOwner,
      };

      const { data: newComp, error: compErr } = await client
        .from('crm_companies')
        .insert(insertData)
        .select('id')
        .single();

      if (compErr || !newComp) {
        console.error('[CompanySync] Insert company failed:', compErr?.message);
        return null;
      }

      targetCompanyId = newComp.id;
      console.log(`[CompanySync] Created new ${classification.categoryLabel} in crm_companies: "${candidateName}" (ID: ${targetCompanyId})`);
    }

    // 3. Link contact to this company
    await client
      .from('crm_contacts')
      .update({
        company_id: targetCompanyId,
        business_name: candidateName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    // 4. Link associated deals to this company
    const { data: dealLinks } = await client
      .from('crm_deal_contacts')
      .select('deal_id')
      .eq('contact_id', contactId);

    if (dealLinks && dealLinks.length > 0) {
      const dealIds = dealLinks.map((d: any) => d.deal_id).filter(Boolean);
      await client
        .from('crm_deals')
        .update({
          company_id: targetCompanyId,
          company_name: candidateName,
          updated_at: new Date().toISOString(),
        })
        .in('id', dealIds);
    }

    // 5. Route to appropriate admin system:
    if (classification.entityType === 'clinic') {
      // If clinic, sync to public.clinics table for appointments, doctor scheduling, and /admin/setup
      await ensureClinicSynced(client, candidateName);
    } else if (classification.entityType === 'company') {
      // If commercial company, ensure workspace exists for /admin/companies-setup
      const { data: existingWs } = await client
        .from('crm_workspaces')
        .select('id')
        .eq('name', candidateName)
        .maybeSingle();

      if (!existingWs) {
        const domain = `${candidateName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`;
        await client.from('crm_workspaces').insert({
          name: candidateName,
          workspace_type: 'client_company',
          domain,
          is_active: true,
        });
      }
    }

    return targetCompanyId;
  } catch (err: any) {
    console.error('[CompanySync] ensureCompanyForConvertedClient error:', err);
    return null;
  }
}
