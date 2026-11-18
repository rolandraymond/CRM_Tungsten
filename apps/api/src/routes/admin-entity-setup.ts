import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDatabaseAdmin, createUserDatabaseClient } from '../lib/database.js';

export const adminEntitySetupRouter = Router();

// ============================================================================
// 1. COMPANIES SETUP
// ============================================================================

adminEntitySetupRouter.get('/companies-setup', async (_req: Request, res: Response) => {
  try {
    const admin = getDatabaseAdmin();
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
    const client = createUserDatabaseClient(auth!.accessToken);
    const { data: services } = await client
      .from('services')
      .select('id, service_name, service_code, is_active')
      .order('service_name');

    // Filter commercial companies (excluding clinics and personal brands)
    const commercialCompanies = (companies || []).filter(c =>
      c.industry !== 'عيادة طبية' &&
      c.industry !== 'مركز طبي' &&
      c.industry !== 'براند شخصي' &&
      !c.company_name?.includes('عياد') &&
      !c.company_name?.includes('مركز طبي') &&
      !c.company_name?.includes('براند')
    );

    // Auto-ensure each commercial company has an active client_company workspace
    const wsList = workspaces ? [...workspaces] : [];
    for (const comp of commercialCompanies) {
      const hasWs = wsList.some(w => w.name === comp.company_name || w.id === comp.workspace_id);
      if (!hasWs) {
        const domain = `${comp.company_name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`;
        const { data: newWs } = await admin
          .from('crm_workspaces')
          .insert({
            name: comp.company_name,
            workspace_type: 'client_company',
            domain,
            is_active: true,
          })
          .select('*')
          .single();
        if (newWs) {
          wsList.push(newWs);
        }
      }
    }

    return res.json({
      data: {
        companies: commercialCompanies,
        all_companies: companies || [],
        workspaces: wsList,
        memberships: memberships || [],
        users,
        services: services || [],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

const companyUserSchema = z.object({
  company_id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(12).max(128),
  role: z.enum(['company_owner', 'company_manager', 'sales', 'owner', 'manager']),
});

adminEntitySetupRouter.post('/companies-setup/users', async (req: Request, res: Response) => {
  const parsed = companyUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
  }

  const { company_id, full_name, email, password, role } = parsed.data;

  try {
    const admin = getDatabaseAdmin();

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
      } else {
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
    let userId: string;
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
      } else {
        return res.status(400).json({ error: authError?.message || 'تعذر إنشاء الحساب' });
      }
    } else {
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
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

adminEntitySetupRouter.put('/companies-setup/membership', async (req: Request, res: Response) => {
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
    const admin = getDatabaseAdmin();
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
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

adminEntitySetupRouter.delete('/companies-setup/membership', async (req: Request, res: Response) => {
  const { workspace_id, user_id } = req.body;
  if (!workspace_id || !user_id) {
    return res.status(400).json({ error: 'workspace_id and user_id are required' });
  }

  try {
    const admin = getDatabaseAdmin();
    const { error } = await admin
      .from('crm_workspace_members')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

adminEntitySetupRouter.post('/companies-setup/services', async (req: Request, res: Response) => {
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
    const client = createUserDatabaseClient(auth!.accessToken);
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
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. INDIVIDUAL CLIENTS SETUP
// ============================================================================

adminEntitySetupRouter.get('/individuals-setup', async (_req: Request, res: Response) => {
  try {
    const admin = getDatabaseAdmin();
    const auth = res.locals.auth;
    const client = createUserDatabaseClient(auth!.accessToken);

    // 1. Fetch personal brand entities from crm_companies
    let { data: brandCompanies, error: bErr } = await admin
      .from('crm_companies')
      .select('*')
      .or(`industry.eq.براند شخصي,company_name.ilike.%براند%`)
      .order('created_at', { ascending: false });

    if (bErr) {
      return res.status(500).json({ error: bErr.message });
    }

    // 2. Fetch brand contacts
    const { data: contacts } = await client
      .from('crm_contacts')
      .select('*')
      .or(`job_title.ilike.%شخصي%,business_name.ilike.%براند%`)
      .order('created_at', { ascending: false });

    const brandsList = brandCompanies ? [...brandCompanies] : [];

    // Auto-mirror any brand contacts into crm_companies if missing
    for (const cont of contacts || []) {
      const bName = cont.full_name?.trim() || cont.business_name?.trim();
      if (!bName) continue;
      const exists = brandsList.some(b => b.company_name === bName || b.id === cont.company_id);
      if (!exists) {
        const { data: newBrand } = await admin
          .from('crm_companies')
          .insert({
            company_name: bName,
            industry: 'براند شخصي',
            phone: cont.phone_number || cont.whatsapp_number || null,
            city: cont.city || null,
            workspace_id: '11111111-1111-1111-1111-111111111111',
          })
          .select('*')
          .single();
        if (newBrand) {
          brandsList.unshift(newBrand);
          // Link contact to this company
          await admin.from('crm_contacts').update({ company_id: newBrand.id }).eq('id', cont.id);
        }
      }
    }

    // 3. Ensure each brand has a dedicated workspace in crm_workspaces
    const { data: existingWorkspaces } = await admin
      .from('crm_workspaces')
      .select('*')
      .in('workspace_type', ['client_brand', 'client_company', 'brand']);

    const workspacesMap = new Map((existingWorkspaces || []).map(w => [w.id, w]));
    const workspacesNameMap = new Map((existingWorkspaces || []).map(w => [w.name, w]));

    for (const brand of brandsList) {
      let ws = (brand.workspace_id && brand.workspace_id !== '11111111-1111-1111-1111-111111111111')
        ? workspacesMap.get(brand.workspace_id)
        : workspacesNameMap.get(brand.company_name);

      if (!ws) {
        const domain = `${brand.company_name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'brand'}.brand`;
        const { data: createdWs } = await admin
          .from('crm_workspaces')
          .insert({
            name: brand.company_name,
            workspace_type: 'client_brand',
            domain,
            is_active: true,
          })
          .select('*')
          .single();
        if (createdWs) {
          ws = createdWs;
          workspacesMap.set(ws.id, ws);
          workspacesNameMap.set(ws.name, ws);
        }
      }

      if (ws && brand.workspace_id !== ws.id) {
        brand.workspace_id = ws.id;
        await admin.from('crm_companies').update({ workspace_id: ws.id }).eq('id', brand.id);
      }
    }

    // 4. Fetch all memberships across brand workspaces
    const brandWsIds = Array.from(workspacesMap.keys());
    let memberships: any[] = [];
    if (brandWsIds.length > 0) {
      const { data: mems } = await admin
        .from('crm_workspace_members')
        .select('*')
        .in('workspace_id', brandWsIds);
      memberships = mems || [];
    }

    // 5. Fetch brand services (assignments)
    const { data: brandServices } = await admin
      .from('brand_services')
      .select('brand_id, service_id, is_active');

    // 6. Fetch services catalog
    const { data: services } = await client
      .from('services')
      .select('id, service_name, service_code, is_active')
      .order('service_name');

    // 7. Fetch all users directory
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const users = (usersData?.users || []).map(u => ({
      id: u.id,
      email: u.email || '',
      full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'عضو فريق',
      created_at: u.created_at,
    }));

    return res.json({
      data: {
        brands: brandsList,
        workspaces: Array.from(workspacesMap.values()),
        memberships,
        brand_services: brandServices || [],
        services: services || [],
        users,
        // Legacy fallback
        individuals: brandsList.map(b => ({
          id: b.id,
          full_name: b.company_name,
          phone_number: b.phone || '',
          whatsapp_number: b.phone || '',
          email: users.find(u => u.id === b.company_owner_id)?.email || null,
          city: b.city || null,
          job_title: 'براند شخصي',
          lead_status: 'معتمد',
          deals: [],
        })),
        team_users: users,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Add brand team member or brand owner
adminEntitySetupRouter.post('/individuals-setup/users', async (req: Request, res: Response) => {
  const schema = z.object({
    brand_id: z.string().uuid(),
    full_name: z.string().trim().min(1).max(200),
    email: z.string().email().trim().toLowerCase(),
    password: z.string().min(12).max(128),
    role: z.enum([
      'brand_owner',
      'brand_manager',
      'content_creator',
      'videographer_editor',
      'customer_service',
      'sales',
      'moderator',
    ]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
  }

  const { brand_id, full_name, email, password, role } = parsed.data;

  try {
    const admin = getDatabaseAdmin();

    // 1. Find brand and its workspace
    const { data: brand, error: bErr } = await admin
      .from('crm_companies')
      .select('id, company_name, workspace_id, company_owner_id')
      .eq('id', brand_id)
      .single();

    if (bErr || !brand) {
      return res.status(404).json({ error: 'البراند غير موجود' });
    }

    let workspaceId = brand.workspace_id;
    if (!workspaceId || workspaceId === '11111111-1111-1111-1111-111111111111') {
      const domain = `${brand.company_name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'brand'}.brand`;
      const { data: newWs } = await admin
        .from('crm_workspaces')
        .insert({
          name: brand.company_name,
          workspace_type: 'client_brand',
          domain,
          is_active: true,
        })
        .select('id')
        .single();
      if (newWs) {
        workspaceId = newWs.id;
        await admin.from('crm_companies').update({ workspace_id: workspaceId }).eq('id', brand.id);
      }
    }

    // 2. Create user in Auth
    let userId: string;
    const { data: newUser, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        brand_id,
        user_type: role === 'brand_owner' ? 'brand_owner' : 'brand_staff',
      },
    });

    if (authError || !newUser?.user) {
      if (authError?.message?.includes('already been registered') || authError?.code === 'email_exists') {
        const { data: userList } = await admin.auth.admin.listUsers();
        const existing = userList?.users?.find(u => u.email?.toLowerCase() === email);
        if (!existing) {
          return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
        }
        userId = existing.id;
      } else {
        return res.status(400).json({ error: authError?.message || 'تعذر إنشاء الحساب' });
      }
    } else {
      userId = newUser.user.id;
    }

    // 3. Upsert profile
    await admin.from('profiles').upsert({
      id: userId,
      full_name,
    });

    // 4. Upsert membership into crm_workspace_members
    await admin
      .from('crm_workspace_members')
      .upsert({
        workspace_id: workspaceId,
        user_id: userId,
        role,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,user_id' });

    // 5. If role is brand_owner, link company_owner_id
    if (role === 'brand_owner') {
      await admin.from('crm_companies').update({ company_owner_id: userId }).eq('id', brand_id);
    }

    return res.status(201).json({
      data: {
        user_id: userId,
        email,
        full_name,
        role,
        workspace_id: workspaceId,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update brand team member role or active status
adminEntitySetupRouter.put('/individuals-setup/membership', async (req: Request, res: Response) => {
  const schema = z.object({
    workspace_id: z.string().uuid(),
    user_id: z.string().uuid(),
    role: z.enum([
      'brand_owner',
      'brand_manager',
      'content_creator',
      'videographer_editor',
      'customer_service',
      'sales',
      'moderator',
    ]),
    is_active: z.boolean(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
  }

  try {
    const admin = getDatabaseAdmin();
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
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Remove brand team member
adminEntitySetupRouter.delete('/individuals-setup/membership', async (req: Request, res: Response) => {
  const { workspace_id, user_id } = req.body;
  if (!workspace_id || !user_id) {
    return res.status(400).json({ error: 'workspace_id and user_id are required' });
  }

  try {
    const admin = getDatabaseAdmin();
    const { error } = await admin
      .from('crm_workspace_members')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Assign or toggle service for brand (equivalent to clinic_services)
adminEntitySetupRouter.post('/individuals-setup/services/assign', async (req: Request, res: Response) => {
  const schema = z.object({
    brand_id: z.string().uuid(),
    service_id: z.string().uuid(),
    is_active: z.boolean(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
  }

  const { brand_id, service_id, is_active } = parsed.data;

  try {
    const admin = getDatabaseAdmin();
    const { data, error } = await admin
      .from('brand_services')
      .upsert({
        brand_id,
        service_id,
        is_active,
      }, { onConflict: 'brand_id,service_id' })
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

adminEntitySetupRouter.post('/individuals-setup/services', async (req: Request, res: Response) => {
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
    const client = createUserDatabaseClient(auth!.accessToken);
    const code = parsed.data.service_code || 'IND-SRV-' + Date.now().toString(36).toUpperCase();

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
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
