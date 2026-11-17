import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';
import { ensureClinicSynced } from '../lib/clinic-sync.js';
import { ensureCompanyForConvertedClient } from '../lib/company-sync.js';

export const crmRouter = Router();

crmRouter.use(requireAuth);

function getClient(res: Response) {
  const auth = res.locals.auth;
  if (!auth) throw new Error('Unauthenticated');
  return { client: createUserSupabaseClient(auth.accessToken), userId: auth.userId };
}

// ============================================================================
// 1. WORKSPACES & CONTEXT
// ============================================================================

crmRouter.get('/workspaces', async (_req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);

    // 1. Check if user is platform admin
    const adminClient = getSupabaseAdmin();
    const { data: statusData } = await client.rpc('crm_internal_user_status');
    const isPlatformAdmin = Boolean(statusData?.is_admin || statusData?.is_owner);

    // 2. Fetch user's direct memberships using adminClient to avoid client RLS platform_admins restriction
    const { data: memberships, error: memError } = await adminClient
      .from('crm_workspace_members')
      .select(`
        workspace_id,
        role,
        manager_id,
        is_active,
        crm_workspaces (
          id,
          name,
          workspace_type,
          domain,
          is_active,
          created_at
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (memError) {
      console.error('[CRM Workspaces Error]', memError);
      return res.status(500).json({ error: memError.message });
    }

    let workspaces: any[] = [];
    if (memberships) {
      workspaces = memberships
        .filter((m: any) => m.crm_workspaces)
        .map((m: any) => ({
          ...m.crm_workspaces,
          user_role: m.role,
          manager_id: m.manager_id,
        }));
    }

    // 3. If platform admin, also fetch all other workspaces so they can manage/provision them
    let managedClientWorkspaces: any[] = [];
    if (isPlatformAdmin) {
      const { data: allWorkspaces } = await adminClient
        .from('crm_workspaces')
        .select('id, name, workspace_type, domain, is_active, created_at')
        .order('created_at', { ascending: false });

      if (allWorkspaces) {
        // Find workspaces where admin is not directly an operational member
        const directIds = new Set(workspaces.map(w => w.id));
        managedClientWorkspaces = allWorkspaces
          .filter(w => !directIds.has(w.id))
          .map(w => ({
            ...w,
            user_role: 'platform_admin',
            is_managed_only: true, // Platform admin has infrastructure control, not operational access
          }));
      }
    }

    return res.json({
      is_platform_admin: isPlatformAdmin,
      workspaces: [...workspaces, ...managedClientWorkspaces],
    });
  } catch (err: any) {
    console.error('[CRM Workspaces Fetch Exception]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Platform Admin RPC: Provision client company workspace
crmRouter.post('/workspaces/provision', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { name, domain, initialOwnerId, initialOwnerEmail, initialOwnerPassword, initialOwnerName } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Workspace name is required' });
    }

    let ownerId = initialOwnerId;

    // If an email is provided to create/provision a new user account:
    if (!ownerId && initialOwnerEmail) {
      const adminClient = getSupabaseAdmin();
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: initialOwnerEmail,
        password: initialOwnerPassword || 'Tungsten2026!Secure',
        email_confirm: true,
        user_metadata: {
          full_name: initialOwnerName || initialOwnerEmail.split('@')[0],
        },
      });

      if (createError) {
        return res.status(400).json({ error: `Failed to create owner user: ${createError.message}` });
      }

      ownerId = newUser.user.id;
    }

    if (!ownerId) {
      return res.status(400).json({ error: 'Initial owner ID or valid email is required' });
    }

    // Call public.provision_client_company_workspace
    const { data: workspaceId, error: rpcError } = await client.rpc(
      'provision_client_company_workspace',
      {
        p_name: name.trim(),
        p_initial_owner_id: ownerId,
        p_domain: domain?.trim() || null,
      }
    );

    if (rpcError) {
      console.error('[CRM Provision Error]', rpcError);
      return res.status(400).json({ error: rpcError.message });
    }

    return res.status(201).json({
      success: true,
      workspace_id: workspaceId,
      owner_id: ownerId,
    });
  } catch (err: any) {
    console.error('[CRM Provision Exception]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Update workspace settings (Platform Admin or Workspace Owner)
crmRouter.patch('/workspaces/:workspaceId', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId } = req.params;
    const { name, domain, is_active } = req.body;

    const updates: Record<string, any> = {};
    if (typeof name === 'string') updates.name = name.trim();
    if (typeof domain === 'string' || domain === null) updates.domain = domain;
    if (typeof is_active === 'boolean') updates.is_active = is_active;

    const { data, error } = await client
      .from('crm_workspaces')
      .update(updates)
      .eq('id', workspaceId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Workspace members
crmRouter.get('/workspaces/:workspaceId/members', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId } = req.params;

    const { data: members, error } = await client
      .from('crm_workspace_members')
      .select('workspace_id, user_id, role, manager_id, is_active, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Enrich with user emails/names via admin client
    const adminClient = getSupabaseAdmin();
    const userIds = (members || []).map(m => m.user_id);
    let userProfiles: Record<string, { email?: string; full_name?: string }> = {};

    if (userIds.length > 0) {
      const { data: usersData } = await adminClient.auth.admin.listUsers();
      if (usersData?.users) {
        for (const u of usersData.users) {
          if (userIds.includes(u.id)) {
            userProfiles[u.id] = {
              email: u.email,
              full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'مستخدم',
            };
          }
        }
      }
    }

    const enriched = (members || []).map(m => ({
      ...m,
      email: userProfiles[m.user_id]?.email || '',
      full_name: userProfiles[m.user_id]?.full_name || 'عضو الفريق',
      manager_name: m.manager_id ? userProfiles[m.manager_id]?.full_name || 'المدير' : null,
    }));

    return res.json({ data: enriched });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Add member to workspace
crmRouter.post('/workspaces/:workspaceId/members', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const { email, password, full_name, role, manager_id } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    // Permissions check: Only Owner, Moderator, or Platform Admin can add/edit team accounts
    const { data: statusData } = await client.rpc('crm_internal_user_status');
    const isOwnerOrMod = statusData?.is_owner || statusData?.is_admin || statusData?.internal_role === 'moderator';

    const { data: callerMember } = await client
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    const isWsOwner = callerMember?.role === 'owner' || callerMember?.role === 'company_owner' || callerMember?.role === 'moderator';

    if (!isOwnerOrMod && !isWsOwner) {
      return res.status(403).json({
        error: 'عذراً، صلاحية إضافة حسابات الفريق مقتصرة على المالك والمودريتور فقط. مدير المبيعات ليس لديه صلاحية تعديل الحسابات.',
      });
    }

    const adminClient = getSupabaseAdmin();
    let targetUserId: string;

    // Check if user already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existing = existingUsers?.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (existing) {
      targetUserId = existing.id;
    } else {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: password || 'Tungsten2026!Secure',
        email_confirm: true,
        user_metadata: { full_name: full_name || email.split('@')[0] },
      });
      if (createError) {
        return res.status(400).json({ error: createError.message });
      }
      targetUserId = created.user.id;
    }

    const { data, error } = await client
      .from('crm_workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: targetUserId,
        role,
        manager_id: manager_id || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update member role or manager
crmRouter.patch('/workspaces/:workspaceId/members/:memberUserId', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId, memberUserId } = req.params;
    const { role, manager_id, is_active } = req.body;

    // Permissions check: Only Owner, Moderator, or Platform Admin can edit accounts
    const { data: statusData } = await client.rpc('crm_internal_user_status');
    const isOwnerOrMod = statusData?.is_owner || statusData?.is_admin || statusData?.internal_role === 'moderator';

    const { data: callerMember } = await client
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    const isWsOwner = callerMember?.role === 'owner' || callerMember?.role === 'company_owner' || callerMember?.role === 'moderator';

    if (!isOwnerOrMod && !isWsOwner) {
      return res.status(403).json({
        error: 'عذراً، صلاحية تعديل حسابات الفريق مقتصرة على المالك والمودريتور فقط. مدير المبيعات ليس لديه صلاحية تعديل الحسابات.',
      });
    }

    const updates: Record<string, any> = {};
    if (role) updates.role = role;
    if (manager_id !== undefined) updates.manager_id = manager_id;
    if (typeof is_active === 'boolean') updates.is_active = is_active;

    const { data, error } = await client
      .from('crm_workspace_members')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('user_id', memberUserId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Remove member
crmRouter.delete('/workspaces/:workspaceId/members/:memberUserId', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId, memberUserId } = req.params;

    // Permissions check: Only Owner, Moderator, or Platform Admin can remove members
    const { data: statusData } = await client.rpc('crm_internal_user_status');
    const isOwnerOrMod = statusData?.is_owner || statusData?.is_admin || statusData?.internal_role === 'moderator';

    const { data: callerMember } = await client
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    const isWsOwner = callerMember?.role === 'owner' || callerMember?.role === 'company_owner' || callerMember?.role === 'moderator';

    if (!isOwnerOrMod && !isWsOwner) {
      return res.status(403).json({
        error: 'عذراً، إزالة حسابات الفريق مقتصرة على المالك والمودريتور فقط.',
      });
    }

    const { error } = await client
      .from('crm_workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', memberUserId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. CONTACTS / LEADS
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/contacts', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const { q, lead_status, contact_owner_id, source_platform, limit = 50, offset = 0 } = req.query;

    const adminClient = getSupabaseAdmin();
    const { data: memberRecord } = await adminClient
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    let query = client
      .from('crm_contacts')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId);

    if (q && typeof q === 'string') {
      const cleanQ = q.trim();
      query = query.or(`full_name.ilike.%${cleanQ}%,phone_number.ilike.%${cleanQ}%,email.ilike.%${cleanQ}%,business_name.ilike.%${cleanQ}%`);
    }

    if (lead_status && typeof lead_status === 'string') {
      query = query.eq('lead_status', lead_status);
    }

    // Sales role can ONLY see their own assigned contacts/leads
    if (memberRecord?.role === 'sales') {
      query = query.eq('contact_owner_id', userId);
    } else if (contact_owner_id && typeof contact_owner_id === 'string') {
      query = query.eq('contact_owner_id', contact_owner_id);
    }

    if (source_platform && typeof source_platform === 'string') {
      query = query.eq('source_platform', source_platform);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data, total: count });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/contacts', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const body = req.body;

    const rawPhone = (body.phone_number || '').trim();
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const rawEmail = (body.email || '').trim().toLowerCase();

    // 1. Duplicate Prevention: Check if contact already exists by phone or whatsapp
    if (cleanDigits.length >= 7) {
      const lastDigits = cleanDigits.slice(-8);
      const { data: existingByPhone } = await client
        .from('crm_contacts')
        .select('id, full_name, phone_number, lead_id')
        .eq('workspace_id', workspaceId)
        .or(`phone_number.ilike.%${lastDigits}%,whatsapp_number.ilike.%${lastDigits}%`)
        .limit(1)
        .maybeSingle();

      if (existingByPhone) {
        return res.status(409).json({
          error: 'DUPLICATE_CLIENT',
          message: `هذا العميل مسجل مسبقاً بنفس رقم الهاتف (${existingByPhone.full_name} - ${existingByPhone.lead_id || ''})`,
          existingContact: existingByPhone,
        });
      }
    }

    // Check duplicate email if provided
    if (rawEmail && rawEmail.includes('@') && !rawEmail.includes('placeholder')) {
      const { data: existingByEmail } = await client
        .from('crm_contacts')
        .select('id, full_name, email, lead_id')
        .eq('workspace_id', workspaceId)
        .eq('email', rawEmail)
        .limit(1)
        .maybeSingle();

      if (existingByEmail) {
        return res.status(409).json({
          error: 'DUPLICATE_CLIENT',
          message: `هذا العميل مسجل مسبقاً بنفس البريد الإلكتروني (${existingByEmail.full_name} - ${existingByEmail.lead_id || ''})`,
          existingContact: existingByEmail,
        });
      }
    }

    const contactData = {
      workspace_id: workspaceId,
      lead_id: body.lead_id || `SL-${Math.floor(1000 + Math.random() * 9000)}`,
      full_name: body.full_name,
      job_title: body.job_title || null,
      phone_number: body.phone_number || '0000000000',
      whatsapp_number: body.whatsapp_number || null,
      business_phone: body.business_phone || null,
      company_phone: body.company_phone || null,
      email: body.email || null,
      social_profile_link: body.social_profile_link || '-',
      business_name: body.business_name || null,
      medical_specialty: body.medical_specialty || null,
      clinic_address: body.clinic_address || null,
      city: body.city || null,
      district: body.district || null,
      google_maps: body.google_maps || null,
      website: body.website || null,
      business_instagram: body.business_instagram || null,
      business_facebook: body.business_facebook || null,
      branch_count: body.branch_count ? Number(body.branch_count) : 1,
      source_platform: body.source_platform || 'Meta Ads',
      ad_id: body.ad_id || '-',
      lead_status: body.lead_status || 'جديد',
      meeting_date: body.meeting_date || null,
      follow_up_date: body.follow_up_date || null,
      activity_status: body.activity_status || 'معاودة الاتصال',
      meeting_status: body.meeting_status || 'محجوز',
      contact_owner_id: body.contact_owner_id || userId,
      company_id: body.company_id || null,
    };

    const { data, error } = await client
      .from('crm_contacts')
      .insert(contactData)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Auto-classify and sync entity to its corresponding Admin setup department:
    await ensureCompanyForConvertedClient(client, data.id, workspaceId, userId);
    if (
      contactData.business_name &&
      (contactData.medical_specialty || contactData.clinic_address || body.category === 'clinic_doctor' || contactData.business_name.includes('عياد'))
    ) {
      await ensureClinicSynced(client, contactData.business_name);
    }

    return res.status(201).json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.get('/workspaces/:workspaceId/contacts/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { data: contact, error: contactError } = await client
      .from('crm_contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (contactError || !contact) {
      return res.status(404).json({ error: contactError?.message || 'Contact not found' });
    }

    // Linked deals
    const { data: dealLinks } = await client
      .from('crm_deal_contacts')
      .select(`
        deal_id,
        crm_deals (
          id,
          deal_name,
          deal_stage,
          deal_amount,
          currency,
          closing_date,
          deal_owner_id,
          description
        )
      `)
      .eq('contact_id', id);

    let deals = (dealLinks || []).map((l: any) => l.crm_deals).filter(Boolean);

    // If no deal directly linked, check deals associated with the same company or workspace
    if (deals.length === 0 && contact.company_id) {
      const { data: companyDeals } = await client
        .from('crm_deals')
        .select('id, deal_name, deal_stage, deal_amount, currency, closing_date, deal_owner_id, description')
        .eq('workspace_id', workspaceId)
        .eq('company_id', contact.company_id);
      if (companyDeals && companyDeals.length > 0) {
        deals = companyDeals;
      }
    }

    const dealIds = deals.map((d: any) => d.id);

    // Linked activities
    const { data: activities } = await client
      .from('crm_activities')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false });

    // Linked Audit logs for contact + its deals
    let contactLogs: any[] = [];
    const { data: cLogs } = await client
      .from('crm_audit_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('entity_id', id)
      .order('created_at', { ascending: false });
    contactLogs = cLogs || [];

    let dealLogs: any[] = [];
    if (dealIds.length > 0) {
      const { data: dLogs } = await client
        .from('crm_audit_logs')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('entity_id', dealIds)
        .order('created_at', { ascending: false });
      dealLogs = dLogs || [];
    }

    const audit_logs = [...contactLogs, ...dealLogs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Associated company
    let company: any = null;
    if (contact.company_id) {
      const { data: comp } = await client
        .from('crm_companies')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', contact.company_id)
        .single();
      company = comp || null;
    }

    // Enrich user names & emails
    const adminClient = getSupabaseAdmin();
    const uids = new Set<string>();
    if (contact.created_by) uids.add(contact.created_by);
    if (contact.contact_owner_id) uids.add(contact.contact_owner_id);
    (activities || []).forEach((a: any) => { if (a.assigned_user_id) uids.add(a.assigned_user_id); });
    (audit_logs || []).forEach((l: any) => { if (l.performed_by) uids.add(l.performed_by); });
    deals.forEach((d: any) => { if (d.deal_owner_id) uids.add(d.deal_owner_id); });

    let userMap: Record<string, { email: string; full_name: string }> = {};
    if (uids.size > 0) {
      const { data: usersData } = await adminClient.auth.admin.listUsers();
      if (usersData?.users) {
        for (const u of usersData.users) {
          if (uids.has(u.id)) {
            userMap[u.id] = {
              email: u.email || '',
              full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'عضو الفريق',
            };
          }
        }
      }
    }

    const enrichedAuditLogs = audit_logs.map((l: any) => ({
      ...l,
      performed_by_name: userMap[l.performed_by]?.full_name || (l.performed_by ? 'المسؤول' : 'النظام'),
      performed_by_email: userMap[l.performed_by]?.email || '',
    }));

    const enrichedActivities = (activities || []).map((a: any) => ({
      ...a,
      assigned_user_name: userMap[a.assigned_user_id]?.full_name || '',
    }));

    const enrichedDeals = deals.map((d: any) => ({
      ...d,
      owner_name: userMap[d.deal_owner_id]?.full_name || '',
      owner_email: userMap[d.deal_owner_id]?.email || '',
    }));

    // Extract Plan Deliverables from linked deals or fallback for Won/Active clients
    let plan_details: any = null;
    for (const d of deals) {
      if (d.description && typeof d.description === 'string' && d.description.includes('__PLAN_JSON__:')) {
        try {
          const rawPart = d.description.split('__PLAN_JSON__:')[1];
          const jsonStr = rawPart.includes('\n\n') ? rawPart.split('\n\n')[0] : rawPart;
          plan_details = JSON.parse(jsonStr.trim());
          break;
        } catch (e) {
          console.error('[CRM Contact] Failed to parse plan JSON:', e);
        }
      }
    }

    if (plan_details) {
      const isApproved =
        contact.lead_status === 'تم الفوز' ||
        contact.lead_status === 'عميل' ||
        deals.some((d: any) => d.deal_stage === 'عميل' || d.deal_stage === 'عقد') ||
        plan_details.is_approved === true ||
        String(plan_details.status || '').includes('معتمدة');

      plan_details.is_approved = isApproved;
      plan_details.status = isApproved ? 'مشترك بها (معتمدة)' : 'قيد المراجعة والتفاوض (لم تُعتمد بعد)';
      plan_details.badge = isApproved ? 'باقة معتمدة ومفعلة' : 'عرض سعر مقترح (قيد المراجعة)';
    }

    const isClientOrWon =
      contact.lead_status === 'تم الفوز' ||
      contact.lead_status === 'عميل' ||
      deals.some((d: any) => d.deal_stage === 'عميل');

    if (!plan_details && isClientOrWon) {
      plan_details = {
        plan_name: 'الباقة الأساسية (Starter)',
        plan_tier: 'starter',
        plan_code: 'SL-OFFER-MWGIGNAP-8068',
        pricing_location: 'تسعير القاهرة',
        price: 22450,
        billing_cycle: 'شهرياً',
        status: 'مشترك بها (معتمدة)',
        badge: 'باقة معتمدة ومفعلة',
        is_approved: true,
        description: 'باقة موجهة خصيصاً لاستهداف أضعف نقطة في حسابك (معدل التفاعل وحفظ المحتوى Engagement & Saves) لضمان إيقاف التراجع بأقل استثمار مالي.',
        strategy_goal: '🎯 إيقاف هبوط الحساب ورفع مؤشر معدل التفاعل وحفظ المحتوى (Engagement & Saves) ليظهر أول تحسن ملموس في الفحص القادم.',
        diagnostics: {
          account: contact.social_profile_link && contact.social_profile_link !== '-' ? contact.social_profile_link : 'HalalChef@',
          platform: 'YouTube',
          engagement_rate: '0.5%',
          analysis_date: '14 نوفمبر',
          status_label: 'أداء متوسط بإمكانات واعدة',
        },
        services: [
          {
            id: '1',
            title: 'منشورات كاروسيل تفاعلية',
            quantity: 3,
            unit_price: 3150,
            total_price: 9450,
            description: '3 منشورات كاروسيل تعليمية مكثفة لرفع معدل حفظ المحتوى (Saves) وزيادة وقت التصفح',
          },
          {
            id: '2',
            title: 'إدارة الحسابات والصفحات (فيسبوك)',
            quantity: 1,
            unit_price: 5000,
            total_price: 5000,
            description: 'إدارة صفحة فيسبوك وضبط مواعيد النشر المثالية لمنع تراجع الحساب في الخوارزميات.',
          },
          {
            id: '3',
            title: 'خدمة الردود والمتابعة',
            quantity: 1,
            unit_price: 8000,
            total_price: 8000,
            description: 'خدمة الردود والمتابعة للعملاء والتفاعل السريع.',
          },
        ],
      };
    }

    return res.json({
      data: {
        ...contact,
        plan_details,
        creator_name: userMap[contact.created_by]?.full_name || 'فريق Tungsten',
        creator_email: userMap[contact.created_by]?.email || '',
        owner_name: userMap[contact.contact_owner_id]?.full_name || 'غير محدد',
        owner_email: userMap[contact.contact_owner_id]?.email || '',
        company,
        deals: enrichedDeals,
        activities: enrichedActivities,
        audit_logs: enrichedAuditLogs,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.patch('/workspaces/:workspaceId/contacts/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const body = req.body;

    // Do not allow updating workspace_id or created_by
    delete body.workspace_id;
    delete body.created_by;
    delete body.id;

    const { data, error } = await client
      .from('crm_contacts')
      .update(body)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Auto-promote: If status is 'تم الفوز' or 'عميل', ensure an approved deal exists with plan details and marked 'عميل'
    if (body.lead_status === 'تم الفوز' || body.lead_status === 'عميل') {
      const { data: dealLinks } = await client
        .from('crm_deal_contacts')
        .select('deal_id, crm_deals(*)')
        .eq('contact_id', id);

      if (dealLinks && dealLinks.length > 0) {
        for (const dl of dealLinks) {
          const d = (dl as any).crm_deals;
          if (d) {
            let updatedDesc = d.description || '';
            let newAmount = d.deal_amount;
            if (d.description && d.description.includes('__PLAN_JSON__:')) {
              try {
                const rawPart = d.description.split('__PLAN_JSON__:')[1];
                const jsonStr = rawPart.includes('\n\n') ? rawPart.split('\n\n')[0] : rawPart;
                const parsed = JSON.parse(jsonStr.trim());
                parsed.is_approved = true;
                parsed.status = 'مشترك بها (معتمدة)';
                parsed.badge = 'باقة معتمدة ومفعلة';
                updatedDesc = `__PLAN_JSON__:${JSON.stringify(parsed)}\n\nتم اعتماد وتفعيل الخطة رسمياً للعميل`;
                if (parsed.price) newAmount = parsed.price;
              } catch (e) {}
            }
            await client
              .from('crm_deals')
              .update({
                deal_stage: 'عميل',
                deal_amount: newAmount,
                description: updatedDesc,
                updated_at: new Date().toISOString(),
              })
              .eq('id', d.id);
          }
        }
      } else {
        const defaultPlan = {
          plan_name: 'الباقة الأساسية (Starter)',
          plan_tier: 'starter',
          plan_code: 'SL-OFFER-MWHVWS72-3105',
          pricing_location: 'تسعير القاهرة',
          price: 16450,
          billing_cycle: 'شهرياً',
          status: 'مشترك بها (معتمدة)',
          badge: 'باقة معتمدة ونشطة',
          is_approved: true,
          description: 'باقة موجهة خصيصاً لاستهداف أضعف نقطة في حسابك (معدل التفاعل وحفظ المحتوى Engagement & Saves) لضمان إيقاف التراجع بأقل استثمار مالي.',
          strategy_goal: '🎯 إيقاف هبوط الحساب ورفع مؤشر معدل التفاعل وحفظ المحتوى (Engagement & Saves) ليظهر أول تحسن ملموس في الفحص القادم.',
          diagnostics: {
            account: data.social_profile_link && data.social_profile_link !== '-' ? data.social_profile_link : 'HalalChef@',
            platform: 'YouTube',
            engagement_rate: '0.5%',
            analysis_date: '14 نوفمبر',
            status_label: 'أداء متوسط بإمكانات واعدة',
          },
          services: [
            {
              id: '1',
              title: 'منشورات كاروسيل تفاعلية',
              quantity: 3,
              unit_price: 3150,
              total_price: 9450,
              description: '3 منشورات كاروسيل تعليمية مكثفة لرفع معدل حفظ المحتوى (Saves) وزيادة وقت التصفح',
            },
            {
              id: '2',
              title: 'إدارة صفحة تيك توك',
              quantity: 1,
              unit_price: 7000,
              total_price: 7000,
              description: 'إدارة متخصصة لصفحة تيك توك مع ضبط الـ Hooks ومواعيد النشر لدفع الخوارزميات.',
            },
          ],
        };

        const planMarker = `__PLAN_JSON__:${JSON.stringify(defaultPlan)}`;
        const { data: newDeal } = await client
          .from('crm_deals')
          .insert({
            workspace_id: workspaceId,
            deal_name: data.full_name,
            deal_stage: 'عميل',
            deal_amount: 16450,
            currency: 'EGP',
            deal_owner_id: data.contact_owner_id,
            description: planMarker,
          })
          .select('id')
          .single();

        if (newDeal) {
          await client.from('crm_deal_contacts').insert({
            workspace_id: workspaceId,
            deal_id: newDeal.id,
            contact_id: id,
          });
        }
      }

      // Automatically classify and add to crm_companies (Clinic, Brand, Company)
      await ensureCompanyForConvertedClient(client, id, workspaceId);
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/contacts/:id/transfer', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const { new_owner_id } = req.body;

    if (!new_owner_id) {
      return res.status(400).json({ error: 'new_owner_id is required' });
    }

    const { data, error } = await client
      .from('crm_contacts')
      .update({ contact_owner_id: new_owner_id })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update, assign, or approve a plan for contact
crmRouter.post('/workspaces/:workspaceId/contacts/:id/plan', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const body = req.body || {};

    const { data: contact, error: cErr } = await client
      .from('crm_contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (cErr || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const isApproved = Boolean(body.is_approved);
    const planPrice = Number(body.price) || 0;
    const planName = body.plan_name || (isApproved ? 'الباقة الأساسية (Starter)' : 'باقة مخصصة (تحليل الحساب)');
    const planTier = body.plan_tier || 'starter';
    const planCode = body.plan_code || `SL-OFFER-${Date.now().toString().slice(-6)}`;
    const pricingLocation = body.pricing_location || 'تسعير القاهرة';

    const planData = {
      plan_name: planName,
      plan_tier: planTier,
      plan_code: planCode,
      pricing_location: pricingLocation,
      price: planPrice,
      billing_cycle: 'شهرياً',
      status: isApproved ? 'مشترك بها (معتمدة)' : 'قيد المراجعة والتفاوض (لم تُعتمد بعد)',
      is_approved: isApproved,
      badge: isApproved ? 'باقة معتمدة ومفعلة' : 'عرض سعر مقترح (قيد المراجعة)',
      description: body.description || 'باقة تسويقية موجهة لتحقيق أهداف النمو وأفضل عائد.',
      strategy_goal: body.strategy_goal || '🎯 زيادة التفاعل والوصول وتحقيق تحسن ملموس في الأداء.',
      diagnostics: body.diagnostics || {
        account: contact.social_profile_link && contact.social_profile_link !== '-' ? contact.social_profile_link : (contact.full_name || 'الحساب'),
        platform: 'SocialLens',
        engagement_rate: '0.5%',
        analysis_date: new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' }),
        status_label: isApproved ? 'عميل نشط ومعتمد' : 'الخطة المرجحة لهذا الحساب (Best Recommended Fit)',
      },
      services: (Array.isArray(body.services) && body.services.length > 0)
        ? body.services
        : [
            {
              id: '1',
              title: 'منشورات كاروسيل تفاعلية',
              quantity: 3,
              unit_price: 3150,
              total_price: 9450,
              description: '3 منشورات كاروسيل تعليمية مكثفة لرفع معدل حفظ المحتوى (Saves)',
            },
            {
              id: '2',
              title: 'إدارة صفحة تيك توك',
              quantity: 1,
              unit_price: 7000,
              total_price: 7000,
              description: 'إدارة متخصصة لصفحة تيك توك مع ضبط الـ Hooks ومواعيد النشر لدفع الخوارزميات.',
            },
          ],
      available_plans: body.available_plans || undefined,
    };

    const targetLeadStatus = isApproved ? 'تم الفوز' : contact.lead_status;
    const targetDealStage = isApproved ? 'عميل' : 'عرض سعر';

    // 1. Update contact lead status if approved
    if (isApproved && contact.lead_status !== 'تم الفوز') {
      await client
        .from('crm_contacts')
        .update({ lead_status: 'تم الفوز', updated_at: new Date().toISOString() })
        .eq('id', id);
    }

    // 2. Link or Update Deal
    const { data: dealLink } = await client
      .from('crm_deal_contacts')
      .select('deal_id')
      .eq('contact_id', id)
      .limit(1)
      .maybeSingle();

    const planJsonMarker = `__PLAN_JSON__:${JSON.stringify(planData)}`;
    const dealDesc = `${planJsonMarker}\n\n${isApproved ? 'تم اعتماد وتفعيل الخطة بنجاح' : 'عرض سعر مقترح قيد المراجعة'}`;
    const dealName = `${planData.plan_name} - ${contact.full_name}`;
    let dealId = dealLink?.deal_id;

    if (dealId) {
      await client
        .from('crm_deals')
        .update({
          deal_name: dealName,
          deal_stage: targetDealStage,
          deal_amount: planPrice,
          description: dealDesc,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId);
    } else {
      const { data: newDeal } = await client
        .from('crm_deals')
        .insert({
          workspace_id: workspaceId,
          deal_name: dealName,
          deal_stage: targetDealStage,
          deal_amount: planPrice,
          currency: 'EGP',
          description: dealDesc,
          deal_owner_id: contact.contact_owner_id,
          created_by: contact.contact_owner_id,
        })
        .select('id')
        .single();

      if (newDeal) {
        dealId = newDeal.id;
        await client.from('crm_deal_contacts').insert({
          workspace_id: workspaceId,
          deal_id: dealId,
          contact_id: id,
          is_primary: true,
        });
      }
    }

    // 3. Log Activity & Audit
    const actTitle = isApproved
      ? `🎉 اعتماد وتفعيل الخطة رسمياً: ${planData.plan_name}`
      : `📋 تحديث عرض السعر والخطة المقترحة: ${planData.plan_name}`;

    const servicesListText = planData.services
      .map((s: any) => `• ${s.title} (${s.quantity}×) - ${Number(s.total_price).toLocaleString('ar-EG')} ج.م: ${s.description || 'مخرجات معتمدة'}`)
      .join('\n');

    await client.from('crm_activities').insert({
      workspace_id: workspaceId,
      contact_id: id,
      deal_id: dealId || null,
      activity_type: 'ملاحظة',
      title: actTitle,
      details: [
        `💎 اسم الباقة: ${planData.plan_name} (${planData.pricing_location})`,
        `📌 حالة الاعتماد: [${planData.status}]`,
        `💰 القيمة / السعر: ${Number(planData.price).toLocaleString('ar-EG')} ج.م / ${planData.billing_cycle}`,
        `🎯 الهدف الاستراتيجي: ${planData.strategy_goal}`,
        `📋 المخرجات والخدمات المتضمنة (${planData.services.length} خدمات):\n${servicesListText}`,
      ].join('\n\n'),
      completion_status: 'مكتمل',
      performed_at: new Date().toISOString(),
      created_by: contact.contact_owner_id,
    });

    await client.from('crm_audit_logs').insert({
      workspace_id: workspaceId,
      original_workspace_id: workspaceId,
      workspace_type: 'tungsten_internal',
      entity_type: 'crm_contacts',
      entity_id: id,
      action: isApproved ? 'STAGE_CHANGE' : 'UPDATE',
      new_values: {
        plan_name: planData.plan_name,
        plan_price: planData.price,
        is_approved: isApproved,
        status: planData.status,
      },
      performed_by: contact.contact_owner_id,
    });

    return res.json({ success: true, plan: planData });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.delete('/workspaces/:workspaceId/contacts/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { error } = await client
      .from('crm_contacts')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. COMPANIES
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/companies', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId } = req.params;
    const { q, company_owner_id, limit = 50, offset = 0 } = req.query;

    let query = client
      .from('crm_companies')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId);

    if (q && typeof q === 'string') {
      query = query.ilike('company_name', `%${q.trim()}%`);
    }

    if (company_owner_id && typeof company_owner_id === 'string') {
      query = query.eq('company_owner_id', company_owner_id);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data, total: count });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/companies', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const body = req.body;

    const companyData = {
      workspace_id: workspaceId,
      company_name: body.company_name,
      industry: body.industry || null,
      city: body.city || null,
      address: body.address || null,
      phone: body.phone || null,
      website: body.website || null,
      company_owner_id: body.company_owner_id || userId,
    };

    const { data, error } = await client
      .from('crm_companies')
      .insert(companyData)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Auto-sync entity to its corresponding Admin setup department:
    const admin = getSupabaseAdmin();
    const isClinic =
      companyData.industry === 'عيادة طبية' ||
      companyData.industry === 'مركز طبي' ||
      companyData.company_name?.includes('عياد') ||
      companyData.company_name?.includes('مركز');

    const isBrand =
      companyData.industry === 'براند شخصي' ||
      companyData.company_name?.includes('براند');

    if (isClinic) {
      // 1. Clinic: Sync to public.clinics with active services for /admin/setup and /admin/team
      await ensureClinicSynced(admin, data.company_name);
    } else if (isBrand) {
      // 2. Personal Brand: Ensure contact in crm_contacts so it appears in /admin/individuals-setup
      const { data: existingContact } = await admin
        .from('crm_contacts')
        .select('id')
        .eq('company_id', data.id)
        .maybeSingle();

      if (!existingContact) {
        await admin.from('crm_contacts').insert({
          workspace_id: workspaceId,
          lead_id: `BRD-${Math.floor(1000 + Math.random() * 9000)}`,
          full_name: data.company_name,
          business_name: data.company_name,
          job_title: 'براند شخصي',
          phone_number: data.phone || '0000000000',
          company_id: data.id,
          contact_owner_id: data.company_owner_id || userId,
          source_platform: 'Direct CRM',
          lead_status: 'جديد',
        });
      }
    } else {
      // 3. Commercial Company: Ensure client_company workspace exists for /admin/companies-setup
      const { data: existingWs } = await admin
        .from('crm_workspaces')
        .select('id')
        .eq('name', data.company_name)
        .maybeSingle();

      if (!existingWs) {
        const domain = `${data.company_name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`;
        await admin.from('crm_workspaces').insert({
          name: data.company_name,
          workspace_type: 'client_company',
          domain,
          is_active: true,
        });
      }
    }

    return res.status(201).json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.get('/workspaces/:workspaceId/companies/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { data: company, error } = await client
      .from('crm_companies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (error || !company) {
      return res.status(404).json({ error: error?.message || 'Company not found' });
    }

    // Linked contacts
    const { data: contacts } = await client
      .from('crm_contacts')
      .select('id, full_name, job_title, phone_number, email, lead_status')
      .eq('company_id', id);

    // Linked deals
    const { data: deals } = await client
      .from('crm_deals')
      .select('id, deal_name, deal_stage, deal_amount, currency, closing_date')
      .eq('company_id', id);

    return res.json({
      data: {
        ...company,
        contacts: contacts || [],
        deals: deals || [],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.patch('/workspaces/:workspaceId/companies/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const body = req.body;

    delete body.workspace_id;
    delete body.created_by;
    delete body.id;

    const { data, error } = await client
      .from('crm_companies')
      .update(body)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/companies/:id/transfer', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const { new_owner_id } = req.body;

    if (!new_owner_id) {
      return res.status(400).json({ error: 'new_owner_id is required' });
    }

    const { data, error } = await client
      .from('crm_companies')
      .update({ company_owner_id: new_owner_id })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.delete('/workspaces/:workspaceId/companies/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { error } = await client
      .from('crm_companies')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 4. DEALS (PIPELINE & KANBAN)
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/deals', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const { deal_stage, deal_owner_id, company_id } = req.query;

    const adminClient = getSupabaseAdmin();
    const { data: memberRecord } = await adminClient
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    let query = client
      .from('crm_deals')
      .select(`
        *,
        crm_companies (
          id,
          company_name
        ),
        crm_deal_contacts (
          contact_id,
          crm_contacts (
            id,
            full_name,
            phone_number,
            email
          )
        )
      `)
      .eq('workspace_id', workspaceId);

    if (deal_stage && typeof deal_stage === 'string') {
      query = query.eq('deal_stage', deal_stage);
    }

    // Sales role can ONLY see their own assigned deals
    if (memberRecord?.role === 'sales') {
      query = query.eq('deal_owner_id', userId);
    } else if (deal_owner_id && typeof deal_owner_id === 'string') {
      query = query.eq('deal_owner_id', deal_owner_id);
    }

    if (company_id && typeof company_id === 'string') {
      query = query.eq('company_id', company_id);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Format linked contacts nicely
    const formatted = (data || []).map((d: any) => ({
      ...d,
      company_name: d.crm_companies?.company_name || null,
      contacts: (d.crm_deal_contacts || [])
        .map((dc: any) => dc.crm_contacts)
        .filter(Boolean),
    }));

    return res.json({ data: formatted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/deals', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const body = req.body;

    // Permissions check: Only Owner, Moderator, or Platform Admin can manually add deals
    const { data: statusData } = await client.rpc('crm_internal_user_status');
    const isOwnerOrMod = statusData?.is_owner || statusData?.is_admin || statusData?.internal_role === 'moderator';

    const { data: callerMember } = await client
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    const isWsOwner = callerMember?.role === 'owner' || callerMember?.role === 'company_owner' || callerMember?.role === 'moderator';

    if (!isOwnerOrMod && !isWsOwner) {
      return res.status(403).json({
        error: 'صلاحية إضافة الصفقات يدوياً مقتصرة على المالك والمودريتور فقط. الصفقات تنشأ تلقائياً عند تحويل الليد إلى عميل.',
      });
    }

    const dealData = {
      workspace_id: workspaceId,
      deal_name: body.deal_name,
      deal_stage: body.deal_stage || 'مكالمة',
      deal_amount: body.deal_amount !== undefined ? Number(body.deal_amount) : 25000,
      currency: body.currency || 'EGP',
      closing_date: body.closing_date || null,
      deal_owner_id: body.deal_owner_id || userId,
      company_id: body.company_id || null,
      description: body.description || null,
    };

    const { data: deal, error: dealError } = await client
      .from('crm_deals')
      .insert(dealData)
      .select()
      .single();

    if (dealError) {
      return res.status(400).json({ error: dealError.message });
    }

    // Link contacts if provided
    if (Array.isArray(body.contact_ids) && body.contact_ids.length > 0) {
      const links = body.contact_ids.map((cid: string) => ({
        workspace_id: workspaceId,
        deal_id: deal.id,
        contact_id: cid,
      }));
      await client.from('crm_deal_contacts').insert(links);
    }

    return res.status(201).json({ data: deal });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.get('/workspaces/:workspaceId/deals/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { data: deal, error } = await client
      .from('crm_deals')
      .select(`
        *,
        crm_companies (*),
        crm_deal_contacts (
          contact_id,
          crm_contacts (*)
        )
      `)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (error || !deal) {
      return res.status(404).json({ error: error?.message || 'Deal not found' });
    }

    const { data: activities } = await client
      .from('crm_activities')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: false });

    return res.json({
      data: {
        ...deal,
        contacts: (deal.crm_deal_contacts || []).map((dc: any) => dc.crm_contacts).filter(Boolean),
        activities: activities || [],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.patch('/workspaces/:workspaceId/deals/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const body = req.body;

    delete body.workspace_id;
    delete body.created_by;
    delete body.id;

    if (body.deal_amount !== undefined) {
      body.deal_amount = Number(body.deal_amount);
    }

    const { data, error } = await client
      .from('crm_deals')
      .update(body)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fast stage update for Kanban drag & drop
crmRouter.post('/workspaces/:workspaceId/deals/:id/stage', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const { stage } = req.body;

    const validStages = [
      'مكالمة',
      'زيارة',
      'عرض سعر',
      'عقد',
      'عميل',
      'خسارة مغلقة',
      'غير مؤهل',
      'فقدان العميل',
    ];

    if (!validStages.includes(stage)) {
      return res.status(400).json({ error: `Invalid deal stage: ${stage}` });
    }

    const { data, error } = await client
      .from('crm_deals')
      .update({ deal_stage: stage })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Automatically promote lead to active client if stage is 'عقد' or 'عميل'
    if (stage === 'عقد' || stage === 'عميل') {
      const { data: links } = await client
        .from('crm_deal_contacts')
        .select('contact_id')
        .eq('deal_id', id);

      if (links && links.length > 0) {
        const cids = links.map((l: any) => l.contact_id).filter(Boolean);
        await client
          .from('crm_contacts')
          .update({
            lead_status: 'تم الفوز',
            updated_at: new Date().toISOString(),
          })
          .in('id', cids);

        // Automatically classify and add to crm_companies (Clinic, Brand, Company)
        for (const cid of cids) {
          await ensureCompanyForConvertedClient(client, cid, workspaceId, userId);
        }
      }
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Link / Unlink contact from deal
crmRouter.post('/workspaces/:workspaceId/deals/:id/contacts', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const { contact_id } = req.body;

    if (!contact_id) {
      return res.status(400).json({ error: 'contact_id is required' });
    }

    const { data, error } = await client
      .from('crm_deal_contacts')
      .insert({
        workspace_id: workspaceId,
        deal_id: id,
        contact_id,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.delete('/workspaces/:workspaceId/deals/:id/contacts/:contactId', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id, contactId } = req.params;

    const { error } = await client
      .from('crm_deal_contacts')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('deal_id', id)
      .eq('contact_id', contactId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/deals/:id/transfer', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const { new_owner_id } = req.body;

    if (!new_owner_id) {
      return res.status(400).json({ error: 'new_owner_id is required' });
    }

    const { data, error } = await client
      .from('crm_deals')
      .update({ deal_owner_id: new_owner_id })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.delete('/workspaces/:workspaceId/deals/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { error } = await client
      .from('crm_deals')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 5. ACTIVITIES, TASKS, MEETINGS, FOLLOW-UPS
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/activities', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const { activity_type, completion_status, meeting_status, contact_id, company_id, deal_id, assigned_user_id } = req.query;

    const adminClient = getSupabaseAdmin();
    const { data: memberRecord } = await adminClient
      .from('crm_workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    let query = client
      .from('crm_activities')
      .select(`
        *,
        crm_contacts (id, full_name, phone_number),
        crm_companies (id, company_name),
        crm_deals (id, deal_name)
      `)
      .eq('workspace_id', workspaceId);

    if (activity_type && typeof activity_type === 'string') {
      query = query.eq('activity_type', activity_type);
    }
    if (completion_status && typeof completion_status === 'string') {
      query = query.eq('completion_status', completion_status);
    }
    if (meeting_status && typeof meeting_status === 'string') {
      query = query.eq('meeting_status', meeting_status);
    }
    if (contact_id && typeof contact_id === 'string') {
      query = query.eq('contact_id', contact_id);
    }
    if (company_id && typeof company_id === 'string') {
      query = query.eq('company_id', company_id);
    }
    if (deal_id && typeof deal_id === 'string') {
      query = query.eq('deal_id', deal_id);
    }

    if (memberRecord?.role === 'sales') {
      query = query.eq('assigned_user_id', userId);
    } else if (assigned_user_id && typeof assigned_user_id === 'string') {
      query = query.eq('assigned_user_id', assigned_user_id);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/activities', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;
    const body = req.body;

    const activityData = {
      workspace_id: workspaceId,
      activity_type: body.activity_type || 'مهمة',
      title: body.title,
      details: body.details || null,
      assigned_user_id: body.assigned_user_id || userId,
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      due_date: body.due_date || null,
      reminder_at: body.reminder_at || null,
      meeting_status: body.meeting_status || null,
      completion_status: body.completion_status || 'قيد الانتظار',
      contact_id: body.contact_id || null,
      company_id: body.company_id || null,
      deal_id: body.deal_id || null,
    };

    const { data, error } = await client
      .from('crm_activities')
      .insert(activityData)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.patch('/workspaces/:workspaceId/activities/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;
    const body = req.body;

    delete body.workspace_id;
    delete body.created_by;
    delete body.id;

    const { data, error } = await client
      .from('crm_activities')
      .update(body)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.post('/workspaces/:workspaceId/activities/:id/toggle-complete', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { data: current, error: getError } = await client
      .from('crm_activities')
      .select('completion_status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (getError || !current) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const nextStatus = current.completion_status === 'مكتمل' ? 'قيد الانتظار' : 'مكتمل';

    const { data, error } = await client
      .from('crm_activities')
      .update({ completion_status: nextStatus })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.delete('/workspaces/:workspaceId/activities/:id', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId, id } = req.params;

    const { error } = await client
      .from('crm_activities')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 6. DASHBOARD & ANALYTICS
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/dashboard', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId } = req.params;

    // 1. Fetch deals
    const { data: deals, error: dealsErr } = await client
      .from('crm_deals')
      .select('id, deal_stage, deal_amount, created_at, closing_date')
      .eq('workspace_id', workspaceId);

    if (dealsErr) {
      return res.status(400).json({ error: dealsErr.message });
    }

    const totalDeals = deals?.length || 0;
    let pipelineValue = 0;
    let wonDeals = 0;
    let wonValue = 0;
    let lostDeals = 0;

    const stageMap: Record<string, { count: number; total: number }> = {
      'مكالمة': { count: 0, total: 0 },
      'زيارة': { count: 0, total: 0 },
      'عرض سعر': { count: 0, total: 0 },
      'عقد': { count: 0, total: 0 },
      'عميل': { count: 0, total: 0 },
      'خسارة مغلقة': { count: 0, total: 0 },
      'غير مؤهل': { count: 0, total: 0 },
      'فقدان العميل': { count: 0, total: 0 },
    };

    for (const d of deals || []) {
      const amt = Number(d.deal_amount) || 0;
      pipelineValue += amt;

      if (stageMap[d.deal_stage]) {
        stageMap[d.deal_stage].count++;
        stageMap[d.deal_stage].total += amt;
      }

      if (d.deal_stage === 'عميل') {
        wonDeals++;
        wonValue += amt;
      } else if (d.deal_stage === 'خسارة مغلقة' || d.deal_stage === 'فقدان العميل') {
        lostDeals++;
      }
    }

    const closedDeals = wonDeals + lostDeals;
    const winRate = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;

    // 2. Fetch contacts counts by status
    const { data: contacts } = await client
      .from('crm_contacts')
      .select('id, lead_status, source_platform, follow_up_date, meeting_date')
      .eq('workspace_id', workspaceId);

    const totalContacts = contacts?.length || 0;
    const contactsByStatus: Record<string, number> = {};
    for (const c of contacts || []) {
      const st = c.lead_status || 'غير محدد';
      contactsByStatus[st] = (contactsByStatus[st] || 0) + 1;
    }

    // 3. Upcoming meetings
    const { data: upcomingMeetings } = await client
      .from('crm_activities')
      .select(`
        id,
        title,
        start_date,
        due_date,
        meeting_status,
        contact_id,
        crm_contacts (id, full_name, phone_number)
      `)
      .eq('workspace_id', workspaceId)
      .eq('activity_type', 'اجتماع')
      .order('due_date', { ascending: true })
      .limit(5);

    // 4. Pending tasks & follow-ups
    const { data: pendingTasks } = await client
      .from('crm_activities')
      .select(`
        id,
        title,
        activity_type,
        due_date,
        completion_status,
        crm_contacts (id, full_name)
      `)
      .eq('workspace_id', workspaceId)
      .neq('completion_status', 'مكتمل')
      .order('due_date', { ascending: true })
      .limit(5);

    // 5. Recent activities
    const { data: recentActivities } = await client
      .from('crm_activities')
      .select(`
        id,
        activity_type,
        title,
        details,
        created_at,
        completion_status,
        crm_contacts (id, full_name)
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(8);

    return res.json({
      metrics: {
        totalDeals,
        pipelineValue,
        wonDeals,
        wonValue,
        lostDeals,
        winRate,
        totalContacts,
      },
      stageDistribution: stageMap,
      contactsByStatus,
      upcomingMeetings: upcomingMeetings || [],
      pendingTasks: pendingTasks || [],
      recentActivities: recentActivities || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

crmRouter.get('/workspaces/:workspaceId/analytics', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId } = req.params;

    // Contacts by platform
    const { data: contacts } = await client
      .from('crm_contacts')
      .select('id, source_platform, lead_status, created_at')
      .eq('workspace_id', workspaceId);

    const platformBreakdown: Record<string, { total: number; converted: number }> = {};
    for (const c of contacts || []) {
      const src = c.source_platform || 'مباشر / غير محدد';
      if (!platformBreakdown[src]) {
        platformBreakdown[src] = { total: 0, converted: 0 };
      }
      platformBreakdown[src].total++;
      if (c.lead_status === 'عميل' || c.lead_status === 'مؤهل') {
        platformBreakdown[src].converted++;
      }
    }

    // Deals by owner
    const { data: deals } = await client
      .from('crm_deals')
      .select('id, deal_owner_id, deal_stage, deal_amount')
      .eq('workspace_id', workspaceId);

    const adminClient = getSupabaseAdmin();
    const { data: usersData } = await adminClient.auth.admin.listUsers();
    const userNameMap: Record<string, string> = {};
    for (const u of usersData?.users || []) {
      userNameMap[u.id] = u.user_metadata?.full_name || u.email?.split('@')[0] || u.id.slice(0, 8);
    }

    const repPerformance: Record<string, { name: string; dealsCount: number; totalValue: number; wonCount: number; wonValue: number }> = {};
    for (const d of deals || []) {
      const ownerId = d.deal_owner_id || 'unassigned';
      if (!repPerformance[ownerId]) {
        repPerformance[ownerId] = {
          name: userNameMap[ownerId] || 'غير معين',
          dealsCount: 0,
          totalValue: 0,
          wonCount: 0,
          wonValue: 0,
        };
      }
      const amt = Number(d.deal_amount) || 0;
      repPerformance[ownerId].dealsCount++;
      repPerformance[ownerId].totalValue += amt;
      if (d.deal_stage === 'عميل') {
        repPerformance[ownerId].wonCount++;
        repPerformance[ownerId].wonValue += amt;
      }
    }

    return res.json({
      platforms: platformBreakdown,
      repPerformance: Object.values(repPerformance),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 7. AUDIT LOGS
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/audit-logs', async (req: Request, res: Response) => {
  try {
    const { client } = getClient(res);
    const { workspaceId } = req.params;
    const { limit = 100, entity_id, entity_type } = req.query;

    let query = client
      .from('crm_audit_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (entity_id && typeof entity_id === 'string') {
      query = query.eq('entity_id', entity_id);
    }
    if (entity_type && typeof entity_type === 'string') {
      query = query.eq('entity_type', entity_type);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ data: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 8. NOTIFICATIONS BELL (OWNER SEES ALL, SALES/MANAGERS SEE THEIRS)
// ============================================================================

crmRouter.get('/workspaces/:workspaceId/notifications', async (req: Request, res: Response) => {
  try {
    const { client, userId } = getClient(res);
    const { workspaceId } = req.params;

    // Check if user is owner / platform admin
    const [adminStatus, membership] = await Promise.all([
      client.rpc('crm_admin_status'),
      client
        .from('crm_workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    const userRole = membership.data?.role;
    const isOwner = adminStatus.data === true || userRole === 'owner';

    // If manager, find all sales reps reporting to this manager
    let managedUserIds: string[] = [];
    if (!isOwner && userRole === 'manager') {
      const { data: teamMembers } = await client
        .from('crm_workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('manager_id', userId)
        .eq('is_active', true);
      managedUserIds = (teamMembers || []).map((m: any) => m.user_id);
    }

    // Fetch recent contacts added/won in the workspace
    let query = client
      .from('crm_contacts')
      .select('id, full_name, lead_id, phone_number, lead_status, source_platform, contact_owner_id, created_by, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(35);

    // Visibility filter:
    // - Owner sees all
    // - Manager sees theirs + their managed sales reps
    // - Sales rep sees only theirs
    if (!isOwner) {
      const allowedIds = [userId, ...managedUserIds];
      if (allowedIds.length === 1) {
        query = query.or(`contact_owner_id.eq.${userId},created_by.eq.${userId}`);
      } else {
        const idListStr = allowedIds.join(',');
        query = query.or(`contact_owner_id.in.(${idListStr}),created_by.in.(${idListStr})`);
      }
    }

    const { data: contacts, error } = await query;
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Lookup user display names
    const ownerIds = Array.from(new Set((contacts || []).map((c: any) => c.contact_owner_id || c.created_by).filter(Boolean)));
    const adminClient = getSupabaseAdmin();
    let nameMap: Record<string, string> = {};
    if (ownerIds.length > 0) {
      const { data: usersData } = await adminClient.auth.admin.listUsers();
      if (usersData?.users) {
        for (const u of usersData.users) {
          nameMap[u.id] = u.user_metadata?.full_name || u.email?.split('@')[0] || 'عضو الفريق';
        }
      }
    }

    const notifications = (contacts || []).map((c: any) => {
      const isWon = c.lead_status === 'تم الفوز' || c.lead_status === 'عميل';
      const ownerName = nameMap[c.contact_owner_id] || nameMap[c.created_by] || 'مسؤول المبيعات';
      return {
        id: `notif-${c.id}`,
        contact_id: c.id,
        lead_id: c.lead_id,
        full_name: c.full_name,
        phone: c.phone_number,
        is_won: isWon,
        type: isWon ? 'client_won' : 'client_added',
        title: isWon ? `تم اعتماد العميل رسمياً: ${c.full_name}` : `تم إضافة عميل جديد: ${c.full_name}`,
        subtitle: `المعرف: ${c.lead_id || '-'} • المسؤول: ${ownerName}`,
        source: c.source_platform || 'SocialLens',
        created_at: c.created_at,
      };
    });

    return res.json({
      notifications,
      total: notifications.length,
      is_owner: isOwner,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
