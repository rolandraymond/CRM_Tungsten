import { createUserSupabaseClient } from '../../lib/supabase.js';
export async function createLead(accessToken, input) {
    const supabase = createUserSupabaseClient(accessToken);
    return await supabase.rpc('crm_create_lead_with_booking', {
        p_input: input,
    });
}
export async function listLeads(accessToken, input) {
    const supabase = createUserSupabaseClient(accessToken);
    const from = (input.page - 1) * input.page_size;
    return await supabase
        .from('leads')
        .select(`
      id,
      clinic_id,
      contact_id,
      requested_service_id,
      requested_service_name_snapshot,
      source,
      status,
      contact_type_at_creation,
      assigned_to,
      next_follow_up_at,
      created_by,
      created_at,
      contact:contacts (
        id,
        full_name,
        phone
      )
    `)
        .eq('clinic_id', input.clinic_id)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + input.page_size);
}
export async function changeLeadStatus(accessToken, leadId, input) {
    return createUserSupabaseClient(accessToken).rpc('crm_change_lead_status', {
        p_clinic_id: input.clinic_id,
        p_lead_id: leadId,
        p_expected_status: input.expected_status,
        p_new_status: input.new_status,
        p_reason: input.reason,
    });
}
export async function addLeadNote(accessToken, leadId, input) {
    const supabase = createUserSupabaseClient(accessToken);
    return await supabase.rpc('add_lead_note', {
        p_clinic_id: input.clinic_id,
        p_lead_id: leadId,
        p_note: input.note,
    });
}
export async function listLeadEvents(accessToken, leadId, input) {
    const supabase = createUserSupabaseClient(accessToken);
    const from = (input.page - 1) * input.page_size;
    return await supabase
        .from('lead_events')
        .select(`
      id,
      event_type,
      performed_by,
      performed_at,
      actor:profiles!lead_events_performed_by_fkey (full_name),
      contact_channel,
      contact_outcome,
      notes,
      changes
    `)
        .eq('clinic_id', input.clinic_id)
        .eq('lead_id', leadId)
        .order('performed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + input.page_size);
}
export async function createBooking(accessToken, leadId, input) {
    return createUserSupabaseClient(accessToken).rpc('crm_create_lead_booking', {
        p_clinic_id: input.clinic_id,
        p_lead_id: leadId,
        p_expected_status: input.expected_status,
        p_starts_at: input.starts_at,
        p_reason: input.reason,
    });
}
//# sourceMappingURL=leads.service.js.map