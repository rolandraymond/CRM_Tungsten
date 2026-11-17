import { Router } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin, createUserSupabaseClient } from '../lib/supabase.js';
export const adminEntitySetupRouter = Router();
// ============================================================================
// 1. COMPANIES SETUP
// ============================================================================
adminEntitySetupRouter.get('/companies-setup', async (_req, res) => {
    try {
        const admin = getSupabaseAdmin();
        const auth = res.locals.auth;
        // 1. Fetch companies
        const { data: companies, error: compErr } = await admin
            .from('crm_companies')
            .select('*')
            .order('company_name');
        if (compErr) {
            return res.status(500).json({ error: compErr.message });
        }
        // 2. Fetch workspaces
        const { data: workspaces, error: wsErr } = await admin
            .from('crm_workspaces')
            .select('*')
            .order('name');
        if (wsErr) {
            return res.status(500).json({ error: wsErr.message });
        }
        // 3. Fetch workspace members
        const { data: memberships, error: memErr } = await admin
            .from('crm_workspace_members')
            .select('*');
        if (memErr) {
            return res.status(500).json({ error: memErr.message });
        }
        // 4. Fetch all users for directory / assignment
        const { data: usersData, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const users = (usersData?.users || []).map(u => ({
            id: u.id,
            email: u.email || '',
            full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'مستخدم',
            created_at: u.created_at,
        }));
        // 5. Fetch catalog services
        const client = createUserSupabaseClient(auth.accessToken);
        const { data: services } = await client
            .from('services')
            .select('id, service_name, service_code, is_active')
            .order('service_name');
        // Filter commercial companies (non-clinics) for primary view, but keep all companies accessible
        const commercialCompanies = (companies || []).filter(c => c.industry !== 'عيادة طبية');
        return res.json({
            data: {
                companies: commercialCompanies.length > 0 ? commercialCompanies : companies,
                all_companies: companies || [],
                workspaces: workspaces || [],
                memberships: memberships || [],
                users,
                services: services || [],
            },
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
const companyUserSchema = z.object({
    company_id: z.string().uuid(),
    full_name: z.string().trim().min(1).max(200),
    email: z.string().email().trim().toLowerCase(),
    password: z.string().min(8).max(128),
    role: z.enum(['company_owner', 'company_manager', 'sales', 'owner', 'manager']),
});
adminEntitySetupRouter.post('/companies-setup/users', async (req, res) => {
    const parsed = companyUserSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    const { company_id, full_name, email, password, role } = parsed.data;
    try {
        const admin = getSupabaseAdmin();
        // 1. Look up the company
        const { data: company, error: cErr } = await admin
            .from('crm_companies')
            .select('*')
            .eq('id', company_id)
            .single();
        if (cErr || !company) {
            return res.status(404).json({ error: 'الشركة غير موجودة' });
        }
        // 2. Ensure a dedicated workspace exists for this company
        let targetWorkspaceId = company.workspace_id;
        if (!targetWorkspaceId) {
            const { data: existingWs } = await admin
                .from('crm_workspaces')
                .select('id')
                .eq('name', company.company_name)
                .maybeSingle();
            if (existingWs) {
                targetWorkspaceId = existingWs.id;
            }
            else {
                const { data: newWs, error: newWsErr } = await admin
                    .from('crm_workspaces')
                    .insert({
                    name: company.company_name,
                    workspace_type: 'client_company',
                    is_active: true,
                })
                    .select('id')
                    .single();
                if (newWsErr || !newWs) {
                    return res.status(500).json({ error: 'تعذر إنشاء مساحة عمل للشركة: ' + newWsErr?.message });
                }
                targetWorkspaceId = newWs.id;
            }
            // Link company to workspace
            await admin
                .from('crm_companies')
                .update({ workspace_id: targetWorkspaceId })
                .eq('id', company.id);
        }
        // 3. Create or find user in Auth
        let userId;
        const { data: newUser, error: authError } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name,
                company_id,
                company_name: company.company_name,
            },
        });
        if (authError || !newUser?.user) {
            if (authError?.message?.includes('already been registered') || authError?.code === 'email_exists') {
                // Find existing user
                const { data: userList } = await admin.auth.admin.listUsers();
                const existing = userList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
                if (!existing) {
                    return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
                }
                userId = existing.id;
            }
            else {
                return res.status(400).json({ error: authError?.message || 'تعذر إنشاء الحساب' });
            }
        }
        else {
            userId = newUser.user.id;
        }
        // 4. Update profile
        await admin.from('profiles').upsert({
            id: userId,
            full_name,
        });
        // 5. Add or update member in crm_workspace_members
        const { data: member, error: memErr } = await admin
            .from('crm_workspace_members')
            .upsert({
            workspace_id: targetWorkspaceId,
            user_id: userId,
            role,
            is_active: true,
        }, { onConflict: 'workspace_id,user_id' })
            .select()
            .single();
        if (memErr) {
            return res.status(500).json({ error: 'تعذر ربط الموظف بالشركة: ' + memErr.message });
        }
        // If owner role, set company_owner_id
        if (role === 'company_owner' || role === 'owner') {
            await admin
                .from('crm_companies')
                .update({ company_owner_id: userId })
                .eq('id', company.id);
        }
        return res.status(201).json({
            data: {
                user: { id: userId, email, full_name },
                membership: member,
            },
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
adminEntitySetupRouter.put('/companies-setup/membership', async (req, res) => {
    const schema = z.object({
        workspace_id: z.string().uuid(),
        user_id: z.string().uuid(),
        role: z.enum(['company_owner', 'company_manager', 'sales', 'owner', 'manager']),
        is_active: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    try {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin
            .from('crm_workspace_members')
            .update({
            role: parsed.data.role,
            is_active: parsed.data.is_active,
            updated_at: new Date().toISOString(),
        })
            .eq('workspace_id', parsed.data.workspace_id)
            .eq('user_id', parsed.data.user_id)
            .select()
            .single();
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        return res.json({ data });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
adminEntitySetupRouter.delete('/companies-setup/membership', async (req, res) => {
    const { workspace_id, user_id } = req.body;
    if (!workspace_id || !user_id) {
        return res.status(400).json({ error: 'workspace_id and user_id are required' });
    }
    try {
        const admin = getSupabaseAdmin();
        const { error } = await admin
            .from('crm_workspace_members')
            .delete()
            .eq('workspace_id', workspace_id)
            .eq('user_id', user_id);
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
adminEntitySetupRouter.post('/companies-setup/services', async (req, res) => {
    const schema = z.object({
        service_name: z.string().trim().min(1).max(200),
        service_code: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    try {
        const auth = res.locals.auth;
        const client = createUserSupabaseClient(auth.accessToken);
        const code = parsed.data.service_code || 'SRV-' + Date.now().toString(36).toUpperCase();
        const { data, error } = await client
            .from('services')
            .insert({
            service_name: parsed.data.service_name,
            service_code: code,
            is_active: true,
        })
            .select()
            .single();
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        return res.status(201).json({ data });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// ============================================================================
// 2. INDIVIDUAL CLIENTS SETUP
// ============================================================================
adminEntitySetupRouter.get('/individuals-setup', async (_req, res) => {
    try {
        const admin = getSupabaseAdmin();
        const auth = res.locals.auth;
        const client = createUserSupabaseClient(auth.accessToken);
        // 1. Fetch individual contacts
        const { data: contacts, error: cErr } = await client
            .from('crm_contacts')
            .select('*')
            .order('created_at', { ascending: false });
        if (cErr) {
            return res.status(500).json({ error: cErr.message });
        }
        // Filter individuals (not associated with clinic or company)
        const individuals = (contacts || []).filter(c => !c.company_id && !c.medical_specialty && !c.clinic_address);
        // 2. Fetch team users (Sales, Videographers, Editors, Managers)
        const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const teamUsers = (usersData?.users || []).map(u => ({
            id: u.id,
            email: u.email || '',
            full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'عضو فريق',
        }));
        // 3. Fetch services catalog
        const { data: services } = await client
            .from('services')
            .select('id, service_name, service_code, is_active')
            .order('service_name');
        // 4. Fetch deals linked to contacts
        const { data: dealContacts } = await client
            .from('crm_deal_contacts')
            .select(`
        contact_id,
        crm_deals (
          id,
          deal_name,
          deal_stage,
          deal_amount,
          deal_owner_id,
          closing_date
        )
      `);
        const dealMap = {};
        (dealContacts || []).forEach((dc) => {
            if (dc.contact_id && dc.crm_deals) {
                if (!dealMap[dc.contact_id])
                    dealMap[dc.contact_id] = [];
                dealMap[dc.contact_id].push(dc.crm_deals);
            }
        });
        const enrichedIndividuals = (individuals.length > 0 ? individuals : contacts || []).map(ind => ({
            ...ind,
            deals: dealMap[ind.id] || [],
        }));
        return res.json({
            data: {
                individuals: enrichedIndividuals,
                team_users: teamUsers,
                services: services || [],
            },
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
adminEntitySetupRouter.post('/individuals-setup/account', async (req, res) => {
    const schema = z.object({
        contact_id: z.string().uuid(),
        full_name: z.string().trim().min(1),
        email: z.string().email().trim().toLowerCase(),
        password: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    const { contact_id, full_name, email, password } = parsed.data;
    try {
        const admin = getSupabaseAdmin();
        const auth = res.locals.auth;
        const client = createUserSupabaseClient(auth.accessToken);
        // 1. Create client user in Auth
        let userId;
        const { data: newUser, error: authError } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name,
                contact_id,
                user_type: 'individual_client',
            },
        });
        if (authError || !newUser?.user) {
            if (authError?.message?.includes('already been registered') || authError?.code === 'email_exists') {
                const { data: userList } = await admin.auth.admin.listUsers();
                const existing = userList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
                if (!existing) {
                    return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
                }
                userId = existing.id;
            }
            else {
                return res.status(400).json({ error: authError?.message || 'تعذر إنشاء الحساب' });
            }
        }
        else {
            userId = newUser.user.id;
        }
        // 2. Set profile
        await admin.from('profiles').upsert({
            id: userId,
            full_name,
        });
        // 3. Update contact email
        await client
            .from('crm_contacts')
            .update({ email })
            .eq('id', contact_id);
        return res.status(201).json({
            data: {
                user: { id: userId, email, full_name },
            },
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
adminEntitySetupRouter.put('/individuals-setup/assign-staff', async (req, res) => {
    const schema = z.object({
        contact_id: z.string().uuid(),
        contact_owner_id: z.string().uuid(),
        staff_role: z.string().optional(),
        notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    const { contact_id, contact_owner_id, staff_role, notes } = parsed.data;
    try {
        const auth = res.locals.auth;
        const client = createUserSupabaseClient(auth.accessToken);
        // Update primary contact owner
        const { data: contact, error: cErr } = await client
            .from('crm_contacts')
            .update({
            contact_owner_id,
            updated_at: new Date().toISOString(),
        })
            .eq('id', contact_id)
            .select()
            .single();
        if (cErr) {
            return res.status(400).json({ error: cErr.message });
        }
        // If a specific staff role is provided (like videographer or editor), log an assignment activity
        if (staff_role && contact) {
            await client.from('crm_activities').insert({
                workspace_id: contact.workspace_id,
                contact_id,
                activity_type: 'مهمة عمل',
                assigned_user_id: contact_owner_id,
                notes: `تم تعيين: ${staff_role}${notes ? ' - ' + notes : ''}`,
                completion_status: 'قيد التنفيذ',
            });
        }
        return res.json({ data: contact });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
adminEntitySetupRouter.post('/individuals-setup/services', async (req, res) => {
    const schema = z.object({
        contact_id: z.string().uuid(),
        deal_name: z.string().trim().min(1),
        deal_amount: z.number().positive().default(25000),
        deal_stage: z.string().default('عقد'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    const { contact_id, deal_name, deal_amount, deal_stage } = parsed.data;
    try {
        const auth = res.locals.auth;
        const client = createUserSupabaseClient(auth.accessToken);
        const { data: contact, error: cErr } = await client
            .from('crm_contacts')
            .select('workspace_id, contact_owner_id')
            .eq('id', contact_id)
            .single();
        if (cErr || !contact) {
            return res.status(404).json({ error: 'العميل غير موجود' });
        }
        // Create deal
        const { data: deal, error: dErr } = await client
            .from('crm_deals')
            .insert({
            workspace_id: contact.workspace_id,
            deal_name,
            deal_amount,
            deal_stage,
            deal_owner_id: contact.contact_owner_id,
        })
            .select()
            .single();
        if (dErr) {
            return res.status(400).json({ error: dErr.message });
        }
        // Link deal to contact
        await client.from('crm_deal_contacts').insert({
            deal_id: deal.id,
            contact_id,
        });
        return res.status(201).json({ data: deal });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
//# sourceMappingURL=admin-entity-setup.js.map