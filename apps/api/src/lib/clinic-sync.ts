import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase.js';

/**
 * Ensures a clinic exists in the public.clinics table with active services
 * and is mirrored in crm_companies, so it is instantly available across
 * Admin Setup (/admin/setup), Team management (/admin/team), and Lead creation (/leads/new).
 */
export async function ensureClinicSynced(client: SupabaseClient | null, clinicName: string) {
  if (!clinicName || !clinicName.trim()) return null;
  const name = clinicName.trim();
  const admin = getSupabaseAdmin();

  try {
    // 1. Check if clinic already exists in public.clinics
    let { data: clinic, error: findErr } = await admin
      .from('clinics')
      .select('id, name')
      .ilike('name', name)
      .is('archived_at', null)
      .maybeSingle();

    if (!clinic) {
      // Direct insert via admin service role
      const { data: newClinic, error: insErr } = await admin
        .from('clinics')
        .insert({ name })
        .select('id, name')
        .single();

      if (insErr) {
        console.error(`[ClinicSync] Failed to insert clinic "${name}":`, insErr.message);
      } else {
        clinic = newClinic;
        console.log(`[ClinicSync] Successfully created clinic "${name}" (ID: ${clinic.id}) in public.clinics`);
      }
    }

    if (clinic) {
      // 2. Ensure at least one active service is linked to this clinic in clinic_services
      const { data: existingServices } = await admin
        .from('clinic_services')
        .select('service_id, is_active')
        .eq('clinic_id', clinic.id)
        .eq('is_active', true);

      if (!existingServices || existingServices.length === 0) {
        // Find or create default service
        let { data: defaultService } = await admin
          .from('services')
          .select('id, service_name')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (!defaultService) {
          const { data: createdService } = await admin
            .from('services')
            .insert({
              service_code: 'SRV-GEN-CONSULT',
              service_name: 'كشف واستشارة طبية',
              is_active: true,
            })
            .select('id, service_name')
            .single();
          defaultService = createdService;
        }

        if (defaultService) {
          await admin
            .from('clinic_services')
            .upsert({
              clinic_id: clinic.id,
              service_id: defaultService.id,
              is_active: true,
            }, { onConflict: 'clinic_id,service_id' });
          console.log(`[ClinicSync] Auto-linked service "${defaultService.service_name}" to clinic "${name}"`);
        }
      }

      // 3. Mirror in crm_companies under Tungsten workspace if not already present
      const defaultWorkspaceId = '11111111-1111-1111-1111-111111111111';
      const { data: existingComp } = await admin
        .from('crm_companies')
        .select('id')
        .ilike('company_name', name)
        .maybeSingle();

      if (!existingComp) {
        await admin.from('crm_companies').insert({
          workspace_id: defaultWorkspaceId,
          company_name: name,
          industry: 'عيادة طبية',
        });
        console.log(`[ClinicSync] Auto-mirrored clinic "${name}" in crm_companies`);
      }

      return clinic;
    }
  } catch (err) {
    console.error(`[ClinicSync] Error syncing clinic "${name}":`, err);
  }

  return null;
}

/**
 * Scans all CRM companies and contacts that represent clinics or medical centers
 * and ensures they are mirrored in public.clinics with active services.
 */
export async function syncAllCrmClinics(client?: SupabaseClient, workspaceId?: string) {
  const admin = getSupabaseAdmin();
  try {
    // 1. Companies with clinic/medical industry or keywords
    let query = admin
      .from('crm_companies')
      .select('company_name, industry');

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data: companies } = await query;
    for (const comp of companies || []) {
      const cName = comp.company_name?.trim();
      if (!cName || cName.includes('فردي') || cName.includes('مستقل') || cName.includes('براند')) {
        continue;
      }

      const isClinic =
        comp.industry === 'عيادة طبية' ||
        comp.industry === 'مركز طبي' ||
        cName.includes('عياد') ||
        cName.includes('مركز طبي') ||
        cName.includes('مستشفى') ||
        cName.includes('أسنان') ||
        cName.includes('جلدية');

      if (isClinic) {
        await ensureClinicSynced(admin, cName);
      }
    }

    // 2. Contacts with clinic / medical information (strictly clinical, ignore personal brands / individual clients)
    const { data: contacts } = await admin
      .from('crm_contacts')
      .select('business_name, medical_specialty, clinic_address')
      .not('medical_specialty', 'is', null);

    for (const cont of contacts || []) {
      const bName = cont.business_name?.trim();
      if (bName && (bName.includes('فردي') || bName.includes('شخصي') || bName.includes('مستقل') || bName.includes('براند'))) {
        continue;
      }
      const isExplicitClinic =
        bName &&
        (bName.includes('عياد') || bName.includes('مركز') || bName.includes('مجمع') || bName.includes('مستشفى'));

      const name = isExplicitClinic ? bName : (cont.medical_specialty && !cont.medical_specialty.includes('فردي') ? `عيادة د. ${cont.medical_specialty}` : null);
      if (name && !name.includes('فردي') && !name.includes('مستقل')) {
        await ensureClinicSynced(admin, name);
      }
    }
  } catch (err) {
    console.error('[ClinicSync] syncAllCrmClinics error:', err);
  }
}
