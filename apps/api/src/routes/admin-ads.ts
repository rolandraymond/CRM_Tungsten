import { Router } from 'express';
import { z } from 'zod';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const adminAdsRouter = Router();

const financeId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const metaId = z.string().regex(/^\d+$/);

const adSchema = z.object({
  finance_ad_id: financeId,
  finance_client_id: financeId,
  meta_ad_id: metaId,

  meta_ad_account_id: z
    .string()
    .transform(value => value.replace(/^act_/, ''))
    .pipe(metaId),

  meta_campaign_id: metaId.nullable(),
  meta_adset_id: metaId.nullable(),
  meta_creative_id: metaId.nullable(),

  ad_name: z.string().trim().min(1),
  caption: z.string().nullable(),
  caption_variants: z.array(z.string()),
  thumbnail_url: z.string().nullable(),
  meta_effective_status: z.string().nullable(),

  meta_synced_at: z
    .string()
    .datetime({ offset: true })
    .nullable(),
});

const pageSchema = z.object({
  client_id: financeId,
  ads: z.array(adSchema).max(200),

  pagination: z.object({
    has_more: z.boolean(),
    next_after_id: financeId.nullable(),
  }),
});

export async function readFinanceAds(clientId: number) {
  const base = process.env.FINANCE_CRM_URL;
  const key = process.env.FINANCE_CRM_TOKEN;

  if (!base || !key) {
    throw new Error('Finance is not configured');
  }

  const rows: z.infer<typeof adSchema>[] = [];
  const seen = new Set<string>();
  const signal = AbortSignal.timeout(30000);

  let after = 0;

  for (let page = 0; page < 100; page += 1) {
    const url = new URL(
      `${base.replace(/\/$/, '')}/crm/ads`,
    );

    url.search = new URLSearchParams({
      client_id: String(clientId),
      after_id: String(after),
      limit: '200',
    }).toString();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
      },
      redirect: 'error',
      signal,
    });

    if (!response.ok) {
      throw new Error('Finance unavailable');
    }

    const data = pageSchema.parse(await response.json());

    if (data.client_id !== clientId) {
      throw new Error('Unexpected client');
    }

    let last = after;

    for (const ad of data.ads) {
      if (
        ad.finance_client_id !== clientId ||
        ad.finance_ad_id <= last ||
        seen.has(ad.meta_ad_id)
      ) {
        throw new Error('Invalid ad catalog');
      }

      last = ad.finance_ad_id;
      seen.add(ad.meta_ad_id);
      rows.push(ad);
    }

    if (rows.length > 10000) {
      throw new Error('Catalog limit exceeded');
    }

    if (!data.pagination.has_more) {
      return rows;
    }

    if (
      !data.ads.length ||
      data.pagination.next_after_id !== last
    ) {
      throw new Error('Invalid pagination');
    }

    after = last;
  }

  throw new Error('Pagination limit exceeded');
}

// Mount under adminRouter, after its authentication/admin checks.
adminAdsRouter.post('/sync', async (req, res) => {
  const parsed = z
    .strictObject({ clinic_id: z.uuid() })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED' },
    });
    return;
  }

  const db = createUserSupabaseClient(auth.accessToken);

  try {
    const { data: link, error } = await db
      .from('clinic_finance_links')
      .select('finance_client_id')
      .eq('clinic_id', parsed.data.clinic_id)
      .maybeSingle();

    if (error) {
      throw new Error('Link lookup failed');
    }

    if (!link) {
      res.status(409).json({
        error: { code: 'CLINIC_NOT_LINKED' },
      });
      return;
    }

    const clientId = financeId.parse(
      Number(link.finance_client_id),
    );

    const rows = await readFinanceAds(clientId);

    const ready = rows.filter(
      ad => ad.meta_synced_at !== null,
    );

    const result = await db.rpc('crm_sync_finance_ads', {
      p_clinic_id: parsed.data.clinic_id,
      p_finance_id: clientId,
      p_ads: ready,
    });

    if (result.error) {
      console.error('[ADS SYNC FAILED]', {
        code: result.error.code,
      });

      const status =
        result.error.code === '42501'
          ? 403
          : ['22023', '23505'].includes(result.error.code)
            ? 409
            : 502;

      res.status(status).json({
        error: { code: 'ADS_SAVE_FAILED' },
      });
      return;
    }

    res.json({
      data: {
        saved: result.data,
        skipped: rows.length - ready.length,
      },
    });
  } catch {
    res.status(502).json({
      error: { code: 'ADS_SYNC_UNAVAILABLE' },
    });
  }
});