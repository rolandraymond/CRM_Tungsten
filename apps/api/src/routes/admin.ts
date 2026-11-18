import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserDatabaseClient, getDatabaseAdmin } from '../lib/database.js';
import { adminTeamRouter } from './admin-team.js';
import { adminAdsRouter } from './admin-ads.js';
import { adminEntitySetupRouter } from './admin-entity-setup.js';
import { syncAllCrmClinics } from '../lib/clinic-sync.js';
import { randomUUID } from 'node:crypto';

export const adminRouter = Router();

const financeId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const financeSchema = z.object({
  clients: z.array(
    z.object({
      id: financeId,
      name: z.string().trim().min(1),
      client_code: z.string().nullable(),
    }),
  ),

  services: z.array(
    z.object({
      id: financeId,
      service_code: z.string().trim().min(1),
      service_name: z.string().trim().min(1),
    }),
  ),
});

async function readFinance() {
  const url = process.env.FINANCE_CRM_URL;
  const key = process.env.FINANCE_CRM_TOKEN;

  if (!url || !key) {
    throw new Error('Finance is not configured');
  }

  const response = await fetch(
    `${url.replace(/\/$/, '')}/crm/catalog`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    },
  );

  if (!response.ok) {
    throw new Error('Finance unavailable');
  }

  return financeSchema.parse(await response.json());
}

adminRouter.use(requireAuth);

adminRouter.get('/status', async (_req, res) => {
  try {
    const auth = res.locals.auth!;
    const client = createUserDatabaseClient(auth.accessToken);
    const { data } = await client.rpc('crm_internal_user_status');

    let isAdmin = Boolean(data?.is_admin || data?.is_owner);
    let isOwner = Boolean(data?.is_owner);
    let isManager = Boolean(data?.is_manager);
    let isSales = Boolean(data?.is_sales);
    let internalRole = data?.internal_role || null;
    let isCompanyOwner = false;
    let isCompanyManager = false;
    let isClientCompany = false;
    let isBrandOwner = false;
    let isBrandManager = false;
    let isClientBrand = false;

    // If not a Tungsten internal platform user, check workspace memberships for client company or brand accounts
    let isClinicUser = false;
    let clinicName: string | null = null;
    let clinicRole: string | null = null;

    if (!isAdmin && !isOwner && !isManager && !isSales) {
      const adminClient = getDatabaseAdmin();
      const { data: memberships } = await adminClient
        .from('crm_workspace_members')
        .select(`
          role,
          workspace_id,
          is_active,
          crm_workspaces (
            id,
            name,
            workspace_type,
            is_active
          )
        `)
        .eq('user_id', auth.userId)
        .eq('is_active', true);

      if (memberships && memberships.length > 0) {
        for (const m of memberships) {
          const ws: any = m.crm_workspaces;
          if (ws && ws.is_active) {
            if (ws.workspace_type === 'client_company') {
              isClientCompany = true;
              if (m.role === 'company_owner' || m.role === 'owner') {
                isOwner = true;
                isCompanyOwner = true;
                internalRole = 'company_owner';
                break;
              } else if (m.role === 'company_manager' || m.role === 'manager') {
                isManager = true;
                isCompanyManager = true;
                internalRole = 'company_manager';
                break;
              } else if (m.role === 'sales') {
                isSales = true;
                internalRole = 'sales';
              }
            } else if (ws.workspace_type === 'client_brand' || ws.workspace_type === 'brand') {
              isClientBrand = true;
              if (m.role === 'brand_owner' || m.role === 'owner') {
                isOwner = true;
                isBrandOwner = true;
                internalRole = 'brand_owner';
                break;
              } else if (m.role === 'brand_manager' || m.role === 'manager') {
                isManager = true;
                isBrandManager = true;
                internalRole = 'brand_manager';
                break;
              } else if (m.role === 'sales') {
                isSales = true;
                internalRole = 'sales';
              } else {
                internalRole = m.role;
              }
            }
          }
        }
      }

      // If not any internal, client company, or client brand role, verify if user belongs to clinics
      if (!isCompanyOwner && !isCompanyManager && !isBrandOwner && !isBrandManager && !isClientCompany && !isClientBrand && !isSales && !internalRole) {
        const { data: cm } = await adminClient
          .from('clinic_memberships')
          .select(`
            role,
            clinic_id,
            clinics (
              id,
              name
            )
          `)
          .eq('user_id', auth.userId)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (cm) {
          isClinicUser = true;
          clinicRole = cm.role;
          clinicName = (cm.clinics as any)?.name || 'العيادة';
        } else {
          // If the user has no clinic either, do not force clinic user mode
          isClinicUser = false;
        }
      }
    }

    res.json({
      is_admin: isAdmin,
      is_owner: isOwner,
      is_manager: isManager,
      is_sales: isSales,
      is_company_owner: isCompanyOwner,
      is_company_manager: isCompanyManager,
      is_client_company: isClientCompany,
      is_brand_owner: isBrandOwner,
      is_brand_manager: isBrandManager,
      is_client_brand: isClientBrand,
      is_clinic_user: isClinicUser,
      clinic_name: clinicName,
      clinic_role: clinicRole,
      internal_role: internalRole,
    });
  } catch (err: any) {
    res.status(503).json({ error: { code: 'ADMIN_CHECK_FAILED', message: err?.message } });
  }
});

adminRouter.use(async (_req, res, next) => {
  try {
    const auth = res.locals.auth;

    if (!auth) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED' },
      });
      return;
    }

    const { data, error } = await createUserDatabaseClient(
      auth.accessToken,
    ).rpc('crm_internal_user_status');

    if (error) {
      const fallback = await createUserDatabaseClient(
        auth.accessToken,
      ).rpc('crm_admin_status');
      if (fallback.data === true) {
        res.locals.is_owner = true;
        res.locals.is_manager = false;
        return next();
      }
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
      return;
    }

    const isOwner = data.is_admin === true || data.is_owner === true;

    // Admin setup pages are strictly restricted to the Owner only
    if (!isOwner) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'صفحة الإدارة مخصصة للمالك فقط' },
      });
      return;
    }

    res.locals.is_owner = isOwner;
    res.locals.is_manager = false;
    next();
  } catch {
    res.status(503).json({
      error: { code: 'ADMIN_CHECK_FAILED' },
    });
  }
});

adminRouter.get('/setup', async (_req, res) => {
  const db = createUserDatabaseClient(
    res.locals.auth!.accessToken,
  );

  try {
    // Automatically sync any clinic added in CRM to public.clinics
    await syncAllCrmClinics(getDatabaseAdmin());

    const [clinics, services, links, assignments, finance] =
      await Promise.all([
        db
          .from('clinics')
          .select('id,name')
          .is('archived_at', null)
          .order('created_at', { ascending: false }),

        db
          .from('services')
          .select(
            'id,service_name,service_code,finance_service_id',
          )
          .eq('is_active', true)
          .order('service_name'),

        db
          .from('clinic_finance_links')
          .select('clinic_id,finance_client_id'),

        db
          .from('clinic_services')
          .select('clinic_id,service_id,is_active'),

        readFinance().catch(() => null),
      ]);

    if (
      [clinics, services, links, assignments]
        .some(result => result.error)
    ) {
      throw new Error('Setup lookup failed');
    }

    res.json({
      data: {
        clinics: clinics.data,
        services: services.data,
        links: links.data,
        assignments: assignments.data,
        finance,
      },
    });
  } catch {
    res.status(502).json({
      error: { code: 'SETUP_UNAVAILABLE' },
    });
  }
});

const activateSchema = z.strictObject({
  finance_client_id: financeId,
  clinic_id: z.uuid().nullable(),
  service_ids: z.array(financeId).max(200),
});

adminRouter.post('/finance/activate', async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  try {
    const catalog = await readFinance();

    const client = catalog.clients.find(
      item => item.id === parsed.data.finance_client_id,
    );

    const ids = [...new Set(parsed.data.service_ids)];

    const services = catalog.services.filter(
      item => ids.includes(item.id),
    );

    if (!client || services.length !== ids.length) {
      res.status(400).json({
        error: { code: 'FINANCE_RECORD_UNAVAILABLE' },
      });
      return;
    }

    const { data, error } = await createUserDatabaseClient(
      res.locals.auth!.accessToken,
    ).rpc('crm_activate_finance_client', {
      p_finance_id: client.id,
      p_name: client.name,
      p_clinic_id: parsed.data.clinic_id,
      p_services: services,
    });

    if (error) {
      const status =
        error.code === '42501'
          ? 403
          : ['22023', '23505'].includes(error.code)
            ? 409
            : 502;

      res.status(status).json({
        error: { code: 'ACTIVATION_FAILED' },
      });
      return;
    }

    res.json({
      data: { clinic_id: data },
    });
  } catch {
    res.status(502).json({
      error: { code: 'FINANCE_UNAVAILABLE' },
    });
  }
});

const clinicCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
});

adminRouter.post('/clinics', async (req, res) => {
  const parsed = clinicCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  try {
    const { data, error } = await createUserDatabaseClient(
      res.locals.auth!.accessToken,
    ).rpc('crm_add_manual_clinic', {
      p_name: parsed.data.name,
    });

    if (error) {
      const status =
        error.code === '42501'
          ? 403
          : error.code === '22023'
            ? 400
            : 502;

      res.status(status).json({
        error: { code: 'CLINIC_CREATE_FAILED', message: error.message },
      });
      return;
    }

    res.status(201).json({
      data,
    });
  } catch {
    res.status(502).json({
      error: { code: 'CLINIC_CREATE_FAILED' },
    });
  }
});

const serviceSchema = z.strictObject({
  clinic_id: z.uuid(),
  name: z.string().trim().min(1).max(200),

  // Temporary compatibility with the existing form.
  code: z.string().optional(),
});

adminRouter.post('/services', async (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  try {
    const { data, error } = await createUserDatabaseClient(
      res.locals.auth!.accessToken,
    ).rpc('crm_setup_add_service', {
      p_clinic_id: parsed.data.clinic_id,
      p_name: parsed.data.name,
    });

    if (error) {
      const status =
        error.code === '23505'
          ? 409
          : error.code === '42501'
            ? 403
            : error.code === '22023'
              ? 400
              : 502;

      res.status(status).json({
        error: { code: 'SERVICE_SAVE_FAILED' },
      });
      return;
    }

    res.status(201).json({
      data: { service_id: data },
    });
  } catch {
    res.status(502).json({
      error: { code: 'SERVICE_SAVE_FAILED' },
    });
  }
});

const assignmentSchema = z.strictObject({
  clinic_id: z.uuid(),
  service_id: z.uuid(),
  enabled: z.boolean(),
});

adminRouter.post('/services/assign', async (req, res) => {
  const parsed = assignmentSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  try {
    const { error } = await createUserDatabaseClient(
      res.locals.auth!.accessToken,
    ).rpc('crm_setup_assign_service', {
      p_clinic_id: parsed.data.clinic_id,
      p_service_id: parsed.data.service_id,
      p_enabled: parsed.data.enabled,
    });

    if (error) {
      const status =
        error.code === '42501'
          ? 403
          : error.code === '22023'
            ? 400
            : 502;

      res.status(status).json({
        error: { code: 'SERVICE_SAVE_FAILED' },
      });
      return;
    }

    res.json({
      data: { saved: true },
    });
  } catch {
    res.status(502).json({
      error: { code: 'SERVICE_SAVE_FAILED' },
    });
  }
});

// Mount Setup for Companies and Individual Clients
adminRouter.use('/', adminEntitySetupRouter);

// Guard: Only Owner (Platform Admin) can access sensitive platform management (Team & Ads)
adminRouter.use((_req, res, next) => {
  if (!res.locals.is_owner) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Platform owner access required for this resource',
      },
    });
    return;
  }
  next();
});

adminRouter.use('/team', adminTeamRouter);
adminRouter.use('/ads', adminAdsRouter);
