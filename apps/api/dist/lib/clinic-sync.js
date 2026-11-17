/**
 * Ensures a clinic exists in the public.clinics table so it can be accessed
 * across the entire CRM, Admin Setup, Team management, and Booking system.
 */
export async function ensureClinicSynced(client, clinicName) {
    if (!clinicName || !clinicName.trim())
        return null;
    const name = clinicName.trim();
    try {
        const { data: existing, error: findErr } = await client
            .from('clinics')
            .select('id, name')
            .ilike('name', name)
            .is('archived_at', null)
            .maybeSingle();
        if (!findErr && existing) {
            return existing;
        }
        // Call the security definer RPC crm_add_manual_clinic
        const { data: added, error: rpcErr } = await client.rpc('crm_add_manual_clinic', {
            p_name: name,
        });
        if (!rpcErr && added) {
            console.log(`[ClinicSync] Successfully synced clinic "${name}" to public.clinics (ID: ${added.id})`);
            return added;
        }
    }
    catch (err) {
        console.error(`[ClinicSync] Error syncing clinic "${name}":`, err);
    }
    return null;
}
/**
 * Scans all CRM companies that are medical clinics or centers and ensures they
 * are mirrored in public.clinics.
 */
export async function syncAllCrmClinics(client, workspaceId) {
    try {
        let query = client
            .from('crm_companies')
            .select('company_name, industry');
        if (workspaceId) {
            query = query.eq('workspace_id', workspaceId);
        }
        const { data: companies, error } = await query;
        if (error || !companies)
            return;
        for (const comp of companies) {
            const isClinic = comp.industry === 'عيادة طبية' ||
                comp.industry === 'مركز طبي' ||
                comp.company_name?.includes('عياد') ||
                comp.company_name?.includes('مركز');
            if (isClinic && comp.company_name) {
                await ensureClinicSynced(client, comp.company_name);
            }
        }
    }
    catch (err) {
        console.error('[ClinicSync] syncAllCrmClinics error:', err);
    }
}
//# sourceMappingURL=clinic-sync.js.map