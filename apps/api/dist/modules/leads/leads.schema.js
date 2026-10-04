import { z } from 'zod';
export const createLeadSchema = z
    .strictObject({
    request_id: z.uuid(),
    clinic_id: z.uuid(),
    full_name: z.string().trim().min(1, 'Full name is required'),
    phone: z
        .string()
        .trim()
        .regex(/^\+[1-9][0-9]{7,14}$/, 'Phone must include the country code, for example +201000000001'),
    requested_service_id: z.uuid(),
    source: z.enum([
        'paid_instagram',
        'paid_facebook',
        'tiktok',
        'whatsapp',
        'organic_instagram',
        'organic_facebook',
        'website',
        'other',
    ]),
    attribution_status: z.enum([
        'exact_ad',
        'creative_only',
        'unknown',
        'not_applicable',
    ]),
    ad_id: z.uuid().nullable().default(null),
    meta_creative_id: z
        .string()
        .trim()
        .regex(/^[0-9]+$/, 'Creative ID must contain digits only')
        .nullable()
        .default(null),
    notes: z
        .string()
        .trim()
        .nullable()
        .optional()
        .transform((value) => value || null),
    booking: z.strictObject({
        starts_at: z.iso.datetime({ offset: true }),
        reason: z.string().trim().min(1).max(2000),
    }).nullable().default(null),
    allow_inactive_ad: z.boolean().default(false),
})
    .refine((data) => {
    switch (data.attribution_status) {
        case 'exact_ad':
            return data.ad_id !== null && data.meta_creative_id === null;
        case 'creative_only':
            return data.ad_id === null && data.meta_creative_id !== null;
        case 'unknown':
        case 'not_applicable':
            return data.ad_id === null && data.meta_creative_id === null;
    }
}, {
    message: 'Ad and creative IDs do not match the attribution status',
    path: ['attribution_status'],
})
    .refine((data) => data.attribution_status !== 'not_applicable' ||
    !['paid_instagram', 'paid_facebook'].includes(data.source), {
    message: 'Paid sources require exact_ad, creative_only, or unknown',
    path: ['attribution_status'],
});
export const listLeadsSchema = z.strictObject({
    clinic_id: z.uuid(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    page_size: z.coerce.number().int().min(1).max(50).default(20),
});
export const addLeadNoteSchema = z.strictObject({
    clinic_id: z.uuid(),
    note: z.string().trim().min(1).max(5000),
});
export const changeLeadStatusSchema = z.strictObject({
    clinic_id: z.uuid(),
    expected_status: z.enum([
        'new',
        'in_progress',
        'no_answer',
        'follow_up',
        'converted',
        'not_interested',
    ]),
    new_status: z.enum([
        'new',
        'in_progress',
        'no_answer',
        'follow_up',
        'not_interested',
    ]),
    reason: z.string().trim().min(1).max(2000),
});
export const createBookingSchema = z.strictObject({
    clinic_id: z.uuid(),
    expected_status: z.enum([
        'new', 'in_progress', 'no_answer', 'follow_up', 'not_interested',
    ]),
    starts_at: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(2000),
});
//# sourceMappingURL=leads.schema.js.map