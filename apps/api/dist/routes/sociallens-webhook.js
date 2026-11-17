import { Router } from 'express';
import { getSupabaseAdmin } from '../lib/supabase.js';
export const sociallensWebhookRouter = Router();
// In-memory cache for live inspection of recent webhooks (last 100)
const webhookLogsCache = [];
function addWebhookLog(entry) {
    webhookLogsCache.unshift(entry);
    if (webhookLogsCache.length > 100) {
        webhookLogsCache.pop();
    }
}
// Valid enum values from database constraints
const VALID_LEAD_STATUSES = ['جديد', 'قيد المتابعة', 'تم الفوز', 'خاسر'];
const VALID_ACTIVITY_STATUSES = ['معاودة الاتصال', 'مهتم', 'اهتمام مستقبلي', 'غير مهتم', 'اجتماع'];
const VALID_MEETING_STATUSES = ['محجوز', 'لم يحضر', 'حضر', 'ملغي'];
const VALID_DEAL_STAGES = [
    'مكالمة', 'زيارة', 'عرض سعر', 'عقد', 'عميل', 'خسارة مغلقة', 'غير مؤهل', 'فقدان العميل'
];
const BIZ_MAP = {
    clinic: 'عيادة طبية',
    medical_center: 'مركز طبي متكامل',
    medical: 'عيادة طبية',
    educational_center: 'مركز تعليمي',
    store: 'متجر تجاري',
    restaurant: 'مطعم',
    real_estate: 'عقارات',
    ecommerce: 'تجارة إلكترونية',
    personal_brand: 'علامة شخصية (Personal Brand)',
    company: 'شركة تجارية',
    other: 'نشاط تجاري',
};
function normalizeLeadStatus(val, isWon) {
    if (isWon)
        return 'تم الفوز';
    if (!val)
        return 'جديد';
    const clean = val.trim().toLowerCase();
    if (clean.includes('فوز') ||
        clean.includes('نشط') ||
        clean.includes('عميل') ||
        clean === 'won' ||
        clean === 'active' ||
        clean === 'active_customer' ||
        clean === 'active_client') {
        return 'تم الفوز';
    }
    if (clean.includes('خاسر') || clean.includes('lost') || clean.includes('خسارة') || clean === 'inactive') {
        return 'خاسر';
    }
    if (clean.includes('متابع') ||
        clean.includes('progress') ||
        clean.includes('مهتم') ||
        clean.includes('contacted') ||
        clean.includes('interested') ||
        clean.includes('proposal') ||
        clean.includes('negotiation')) {
        return 'قيد المتابعة';
    }
    return 'جديد';
}
function normalizeActivityStatus(val) {
    if (!val)
        return 'معاودة الاتصال';
    const clean = val.trim().toLowerCase();
    if (clean.includes('اجتماع') || clean.includes('meeting'))
        return 'اجتماع';
    if (clean.includes('اهتمام مستقبلي') || clean.includes('future'))
        return 'اهتمام مستقبلي';
    if (clean.includes('غير مهتم') || clean.includes('not interested') || clean === 'inactive')
        return 'غير مهتم';
    if (clean.includes('مهتم') || clean.includes('interested') || clean.includes('proposal') || clean.includes('negotiation'))
        return 'مهتم';
    if (clean.includes('contacted') || clean.includes('اتصال') || clean.includes('تواصل'))
        return 'معاودة الاتصال';
    return 'معاودة الاتصال';
}
function normalizeMeetingStatus(val) {
    if (!val)
        return 'محجوز';
    const clean = val.trim();
    if (clean.includes('لم يحضر') || clean.toLowerCase().includes('no show'))
        return 'لم يحضر';
    if (clean.includes('حضر') || clean.toLowerCase().includes('show'))
        return 'حضر';
    if (clean.includes('ملغي') || clean.toLowerCase().includes('cancel'))
        return 'ملغي';
    return 'محجوز';
}
function normalizeDealStage(val, isWon) {
    if (isWon)
        return 'عميل';
    // User instruction: Every lead from SocialLens defaults to stage 'زيارة' (تمت الزيارة)
    if (!val)
        return 'زيارة';
    const clean = val.trim().toLowerCase();
    if (clean.includes('عميل') || clean === 'client' || clean === 'active_customer' || clean === 'active_client' || clean === 'active')
        return 'عميل';
    if (clean.includes('عقد') || clean === 'contract' || clean === 'negotiation')
        return 'عقد';
    if (clean.includes('عرض') || clean.includes('proposal') || clean === 'proposal_sent')
        return 'عرض سعر';
    if (clean.includes('زيارة') || clean.includes('visit') || clean.includes('interested'))
        return 'زيارة';
    if (clean.includes('خسارة') || clean.includes('lost') || clean === 'inactive')
        return 'خسارة مغلقة';
    if (clean.includes('غير مؤهل') || clean.includes('disqualified'))
        return 'غير مؤهل';
    if (clean.includes('فقدان') || clean.includes('churned'))
        return 'فقدان العميل';
    // If call or new_lead, default to 'زيارة' as requested
    if (clean.includes('مكالمة') || clean === 'call' || clean === 'new_lead' || clean === 'new')
        return 'زيارة';
    return 'زيارة';
}
// ----------------------------------------------------------------------------
// GET /logs - Retrieve recent webhook logs for workspace
// ----------------------------------------------------------------------------
sociallensWebhookRouter.get('/logs', async (req, res) => {
    const { workspace_id } = req.query;
    if (!workspace_id || typeof workspace_id !== 'string') {
        return res.json({ logs: webhookLogsCache });
    }
    const filtered = webhookLogsCache.filter((l) => l.workspace_id === workspace_id);
    return res.json({ logs: filtered });
});
// ----------------------------------------------------------------------------
// GET /status - Health & Info about SocialLens Webhook integration
// ----------------------------------------------------------------------------
sociallensWebhookRouter.get('/', async (_req, res) => {
    return res.json({
        service: 'Tungsten CRM - SocialLens Webhook Receiver',
        status: 'active',
        supported_events: [
            'lead.created',
            'lead.updated',
            'lead.status_changed',
            'lead.won',
            'deal.updated',
            'client.activated',
        ],
        timestamp: new Date().toISOString(),
    });
});
// ----------------------------------------------------------------------------
// POST / - Main Webhook Receiver from SocialLens
// ----------------------------------------------------------------------------
sociallensWebhookRouter.post('/', async (req, res) => {
    const adminClient = getSupabaseAdmin();
    const rawBody = req.body || {};
    const query = req.query || {};
    const headers = req.headers || {};
    // Support flat payload or nested under customer/data/lead/payload
    const payload = rawBody.customer || rawBody.data || rawBody.lead || rawBody.contact || rawBody;
    const event = rawBody.event || rawBody.event_type || headers['x-webhook-event'] || payload.event || 'lead.webhook_event';
    // 1. Identify Workspace
    let workspaceId = query.workspace_id || headers['x-workspace-id'] || rawBody.workspace_id || payload.workspace_id;
    if (!workspaceId) {
        // Fallback: pick the first active internal workspace or any active workspace
        const { data: wsData } = await adminClient
            .from('crm_workspaces')
            .select('id, name, workspace_type')
            .eq('is_active', true)
            .order('workspace_type', { ascending: false }) // tungsten_internal first
            .limit(1)
            .maybeSingle();
        if (wsData) {
            workspaceId = wsData.id;
        }
    }
    if (!workspaceId) {
        const errorEntry = {
            id: `err-${Date.now()}`,
            workspace_id: 'unknown',
            timestamp: new Date().toISOString(),
            event,
            status: 'error',
            status_code: 400,
            is_won: false,
            lead_status: 'unknown',
            deal_stage: 'unknown',
            message: 'لم يتم العثور على مساحة عمل نشطة (Workspace Not Found)',
            payload: rawBody,
        };
        addWebhookLog(errorEntry);
        return res.status(400).json({ error: 'Active CRM Workspace not found' });
    }
    try {
        // 2. Extract Lead Info
        const rawFullName = payload.name || payload.full_name || payload.client_name || rawBody.customer?.name || rawBody.name || null;
        const rawPhone = payload.phone || payload.phone_number || payload.mobile || rawBody.customer?.phone || rawBody.phone || null;
        const rawCleanPhone = rawPhone ? rawPhone.replace(/[^\d+]/g, '') : '';
        const rawLeadId = payload.lead_id || (payload.id ? `SL-${payload.id}` : null) || (rawBody.customer?.id ? `SL-${rawBody.customer.id}` : null) || payload.external_id || null;
        const rawEmail = payload.email || rawBody.customer?.email || null;
        const rawSocialLink = payload.social_profile_link || payload.handle || payload.linkedin_url || payload.social_link || '-';
        const rawSource = payload.source_platform || payload.lead_source || payload.source || payload.platform || 'SocialLens';
        const rawAdId = payload.ad_id || payload.adId || 'SL-AD';
        // Business Activity & Customer Type Categorization
        const rawBizType = (payload.business_type || payload.business_activity || '').toString().trim().toLowerCase();
        let activityLabel = 'نشاط تجاري عام';
        if (rawBizType === 'clinic')
            activityLabel = 'عيادة طبية';
        else if (rawBizType === 'medical' || rawBizType === 'medical_center')
            activityLabel = 'مركز طبي متكامل';
        else if (rawBizType === 'personal_brand')
            activityLabel = 'علامة شخصية (Personal Brand)';
        else if (rawBizType === 'company')
            activityLabel = 'شركة تجارية';
        else if (rawBizType === 'ecommerce')
            activityLabel = 'تجارة إلكترونية';
        else if (rawBizType === 'store')
            activityLabel = 'متجر تجاري';
        else if (rawBizType === 'restaurant')
            activityLabel = 'مطعم وكافيه';
        else if (rawBizType === 'real_estate')
            activityLabel = 'عقارات وتطوير عقاري';
        else if (rawBizType === 'educational_center')
            activityLabel = 'مركز تعليمي';
        else if (payload.business_activity && BIZ_MAP[payload.business_activity]) {
            activityLabel = BIZ_MAP[payload.business_activity];
        }
        const isMedical = (rawBizType === 'clinic' ||
            rawBizType === 'medical' ||
            rawBizType === 'medical_center' ||
            rawBizType.includes('طبي') ||
            rawBizType.includes('عياد') ||
            Boolean(payload.medical_specialty));
        const isCompany = !isMedical && (rawBizType === 'company' ||
            rawBizType === 'store' ||
            rawBizType === 'restaurant' ||
            rawBizType === 'real_estate' ||
            rawBizType === 'ecommerce' ||
            rawBizType === 'educational_center' ||
            rawBizType.includes('شرك') ||
            rawBizType.includes('مؤسس') ||
            rawBizType.includes('تجار'));
        // Only set medical_specialty if truly medical! For companies and individuals, keep null so they are not misclassified as clinics
        const rawMedicalSpecialty = isMedical ? (payload.medical_specialty || payload.specialty || activityLabel) : null;
        const rawBusinessName = payload.business_name || payload.company_name || payload.clinic_name || (isMedical ? 'عيادة طبية' : isCompany ? activityLabel : 'براند شخصي');
        const rawJobTitle = payload.job_title || payload.title || (isMedical ? 'طبيب / أخصائي' : isCompany ? activityLabel : activityLabel);
        const rawClinicAddress = payload.clinic_address || payload.address || null;
        const rawNotes = payload.notes || payload.details || payload.change_reason || payload.description || '';
        const rawDealAmount = Number(payload.deal_amount || payload.amount || payload.price) || 25000;
        // 3. Determine if Active Client (Promotion Trigger)
        const rawStatus = (payload.status || payload.lead_status || '').toString().trim();
        const rawStage = (payload.deal_stage || payload.stage || '').toString().trim();
        const isWon = Boolean(rawStatus === 'عميل' ||
            rawStatus === 'عميل نشط' ||
            rawStatus === 'تم الفوز' ||
            rawStatus === 'نشط' ||
            rawStatus.toLowerCase() === 'won' ||
            rawStatus.toLowerCase() === 'active' ||
            rawStatus.toLowerCase() === 'active_customer' ||
            rawStatus.toLowerCase() === 'active_client' ||
            rawStatus.toLowerCase() === 'client' ||
            rawStage === 'عميل' ||
            rawStage === 'عقد' ||
            rawStage.toLowerCase() === 'contract' ||
            rawStage.toLowerCase() === 'client' ||
            rawStage.toLowerCase() === 'won' ||
            event === 'deal.won' ||
            event === 'lead.won' ||
            event === 'client.activated' ||
            payload.is_won === true ||
            payload.is_active_client === true);
        const targetLeadStatus = normalizeLeadStatus(rawStatus, isWon);
        const targetActivityStatus = normalizeActivityStatus(payload.activity_status || rawStatus);
        const targetMeetingStatus = normalizeMeetingStatus(payload.meeting_status);
        const targetDealStage = normalizeDealStage(rawStage || rawStatus, isWon);
        // 4. Match Sales Representative ("مين تابع معاه")
        const repSearch = (payload.sales_name || payload.sales_rep || payload.contact_owner || payload.assigned_to || payload.owner_name || payload.owner_email || rawBody.customer?.sales_name || '').toString().trim();
        let matchedUserId = null;
        let repDisplayName = repSearch || 'فريق المبيعات';
        // Fetch team members in this workspace
        const { data: members } = await adminClient
            .from('crm_workspace_members')
            .select('user_id, role')
            .eq('workspace_id', workspaceId)
            .eq('is_active', true);
        const memberUserIds = (members || []).map((m) => m.user_id);
        if (memberUserIds.length > 0) {
            const { data: usersData } = await adminClient.auth.admin.listUsers();
            const allUsers = usersData?.users || [];
            const workspaceUsers = allUsers.filter((u) => memberUserIds.includes(u.id));
            if (repSearch) {
                const lowerSearch = repSearch.toLowerCase();
                // Match by exact ID
                const byId = workspaceUsers.find((u) => u.id === repSearch);
                // Match by email
                const byEmail = workspaceUsers.find((u) => u.email?.toLowerCase().includes(lowerSearch));
                // Match by metadata full_name
                const byName = workspaceUsers.find((u) => {
                    const fn = (u.user_metadata?.full_name || '').toLowerCase();
                    return fn.includes(lowerSearch) || lowerSearch.includes(fn);
                });
                const found = byId || byEmail || byName;
                if (found) {
                    matchedUserId = found.id;
                    repDisplayName = found.user_metadata?.full_name || found.email?.split('@')[0] || repSearch;
                }
            }
            // Fallback: pick first member (manager/owner)
            if (!matchedUserId && workspaceUsers.length > 0) {
                matchedUserId = workspaceUsers[0].id;
                if (!repSearch) {
                    repDisplayName = workspaceUsers[0].user_metadata?.full_name || workspaceUsers[0].email?.split('@')[0] || 'مسؤول المبيعات';
                }
            }
        }
        if (!matchedUserId) {
            // Emergency fallback to any user in auth.users
            const { data: anyUsers } = await adminClient.auth.admin.listUsers();
            if (anyUsers?.users?.[0]) {
                matchedUserId = anyUsers.users[0].id;
            }
        }
        if (!matchedUserId) {
            throw new Error('No valid CRM user found to attribute contact/deal to.');
        }
        // 5. Look up existing Contact by lead_id or phone or email
        let existingContact = null;
        if (rawLeadId) {
            const { data: byLeadId } = await adminClient
                .from('crm_contacts')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('lead_id', rawLeadId)
                .maybeSingle();
            if (byLeadId)
                existingContact = byLeadId;
        }
        if (!existingContact && rawCleanPhone) {
            const phoneCandidates = [
                rawPhone,
                rawCleanPhone,
                rawCleanPhone.startsWith('+20') ? '0' + rawCleanPhone.slice(3) : null,
                rawCleanPhone.startsWith('0') ? '+20' + rawCleanPhone.slice(1) : null,
                rawCleanPhone.startsWith('+2') ? rawCleanPhone.slice(2) : null,
            ].filter(Boolean);
            const { data: byPhone } = await adminClient
                .from('crm_contacts')
                .select('*')
                .eq('workspace_id', workspaceId)
                .in('phone_number', phoneCandidates)
                .maybeSingle();
            if (byPhone)
                existingContact = byPhone;
        }
        if (!existingContact && rawEmail) {
            const { data: byEmail } = await adminClient
                .from('crm_contacts')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('email', rawEmail)
                .maybeSingle();
            if (byEmail)
                existingContact = byEmail;
        }
        let contactId;
        let oldLeadStatus = null;
        let isCreatedNew = false;
        if (existingContact) {
            contactId = existingContact.id;
            oldLeadStatus = existingContact.lead_status;
            // Update contact without overwriting existing data with empty defaults
            const updateData = {
                lead_status: targetLeadStatus,
                activity_status: targetActivityStatus,
                meeting_status: targetMeetingStatus,
                updated_at: new Date().toISOString(),
            };
            if (rawFullName)
                updateData.full_name = rawFullName;
            if (rawPhone)
                updateData.phone_number = rawPhone;
            if (rawEmail)
                updateData.email = rawEmail;
            if (rawJobTitle)
                updateData.job_title = rawJobTitle;
            if (rawSocialLink && rawSocialLink !== '-')
                updateData.social_profile_link = rawSocialLink;
            if (rawBusinessName)
                updateData.business_name = rawBusinessName;
            updateData.medical_specialty = isMedical ? rawMedicalSpecialty : null;
            if (rawClinicAddress)
                updateData.clinic_address = rawClinicAddress;
            if (payload.whatsapp_number)
                updateData.whatsapp_number = payload.whatsapp_number;
            if (payload.city)
                updateData.city = payload.city;
            if (payload.district)
                updateData.district = payload.district;
            if (payload.website)
                updateData.website = payload.website;
            if (payload.meeting_date)
                updateData.meeting_date = payload.meeting_date;
            if (payload.follow_up_date)
                updateData.follow_up_date = payload.follow_up_date;
            if (matchedUserId)
                updateData.contact_owner_id = matchedUserId;
            await adminClient
                .from('crm_contacts')
                .update(updateData)
                .eq('id', contactId);
        }
        else {
            // Insert new contact
            isCreatedNew = true;
            const effectiveLeadId = rawLeadId || `SL-${Date.now().toString().slice(-6)}`;
            const effectiveFullName = rawFullName || 'عميل SocialLens';
            const effectivePhone = rawPhone || '01000000000';
            const insertData = {
                workspace_id: workspaceId,
                lead_id: effectiveLeadId,
                full_name: effectiveFullName,
                phone_number: effectivePhone,
                whatsapp_number: payload.whatsapp_number || effectivePhone,
                business_phone: payload.business_phone || null,
                company_phone: payload.company_phone || null,
                email: rawEmail,
                job_title: rawJobTitle,
                social_profile_link: rawSocialLink,
                business_name: rawBusinessName,
                medical_specialty: rawMedicalSpecialty,
                clinic_address: rawClinicAddress,
                city: payload.city || null,
                district: payload.district || null,
                google_maps: payload.google_maps || null,
                website: payload.website || null,
                business_instagram: payload.business_instagram || null,
                business_facebook: payload.business_facebook || null,
                branch_count: Number(payload.branch_count) || 1,
                source_platform: rawSource,
                ad_id: rawAdId,
                lead_status: targetLeadStatus,
                activity_status: targetActivityStatus,
                meeting_status: targetMeetingStatus,
                meeting_date: payload.meeting_date || null,
                follow_up_date: payload.follow_up_date || null,
                contact_owner_id: matchedUserId,
                created_by: matchedUserId,
            };
            const { data: newContact, error: insErr } = await adminClient
                .from('crm_contacts')
                .insert(insertData)
                .select('id')
                .single();
            if (insErr || !newContact) {
                throw new Error(`Failed to create contact from SocialLens: ${insErr?.message}`);
            }
            contactId = newContact.id;
        }
        // 5.5 Extract or Construct Subscribed Plan / Package Deliverables
        const rawPlan = payload.plan || payload.package || payload.offer || payload.plan_details;
        let planData = null;
        if (rawPlan || isWon) {
            planData = {
                plan_name: rawPlan?.plan_name || rawPlan?.name || 'الباقة الأساسية (Starter)',
                plan_tier: rawPlan?.plan_tier || rawPlan?.tier || 'starter',
                plan_code: rawPlan?.plan_code || rawPlan?.offer_code || rawPlan?.offerNumber || 'SL-OFFER-MWGIGNAP-8068',
                pricing_location: rawPlan?.pricing_location || (rawPlan?.city === 'delta' || rawPlan?.city === 'mansoura' ? 'تسعير الدلتا' : 'تسعير القاهرة'),
                price: Number(rawPlan?.price || rawPlan?.grandTotal || rawPlan?.totalPrice || (isWon ? 22450 : rawDealAmount)),
                billing_cycle: rawPlan?.billing_cycle || 'شهرياً',
                status: rawPlan?.status || 'مشترك بها (معتمدة)',
                badge: 'باقة معتمدة ونشطة',
                description: rawPlan?.description || 'باقة موجهة خصيصاً لاستهداف أضعف نقطة في حسابك (معدل التفاعل وحفظ المحتوى Engagement & Saves) لضمان إيقاف التراجع بأقل استثمار مالي.',
                strategy_goal: rawPlan?.strategy_goal || rawPlan?.expectedImprovement || '🎯 إيقاف هبوط الحساب ورفع مؤشر معدل التفاعل وحفظ المحتوى (Engagement & Saves) ليظهر أول تحسن ملموس في الفحص القادم.',
                diagnostics: rawPlan?.diagnostics || {
                    account: rawPlan?.account_handle || (rawSocialLink !== '-' ? rawSocialLink : 'HalalChef@'),
                    platform: rawPlan?.platform || (rawSource.includes('YouTube') ? 'YouTube' : 'Instagram'),
                    engagement_rate: rawPlan?.engagement_rate || '0.5%',
                    analysis_date: rawPlan?.analysis_date || '14 نوفمبر',
                    status_label: rawPlan?.status_label || 'أداء متوسط بإمكانات واعدة',
                },
                services: (rawPlan?.services && Array.isArray(rawPlan.services) && rawPlan.services.length > 0)
                    ? rawPlan.services.map((s, idx) => ({
                        id: s.id || String(idx + 1),
                        title: s.title || s.serviceName || s.name || `خدمة ${idx + 1}`,
                        quantity: Number(s.quantity) || 1,
                        unit_price: Number(s.unit_price || s.unitPrice) || 0,
                        total_price: Number(s.total_price || s.totalPrice) || (Number(s.unit_price || s.unitPrice || 0) * (Number(s.quantity) || 1)),
                        description: s.description || s.rationale || '',
                    }))
                    : [
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
        // 6. Look up or Create Associated Deal (Pipeline / Won Deals)
        // Find deal linked to contact
        const { data: dealLink } = await adminClient
            .from('crm_deal_contacts')
            .select('deal_id')
            .eq('contact_id', contactId)
            .limit(1)
            .maybeSingle();
        let dealId = dealLink?.deal_id || null;
        let oldDealStage = null;
        const planJsonMarker = planData ? `__PLAN_JSON__:${JSON.stringify(planData)}` : '';
        const dealDesc = [
            planJsonMarker,
            rawNotes ? `SocialLens Webhook: ${rawNotes}` : 'تم إنشاء الصفقة تلقائياً عبر SocialLens Webhook'
        ].filter(Boolean).join('\n\n');
        const effectiveDealAmount = planData ? planData.price : rawDealAmount;
        if (dealId) {
            const { data: existingDeal } = await adminClient
                .from('crm_deals')
                .select('*')
                .eq('id', dealId)
                .single();
            if (existingDeal) {
                oldDealStage = existingDeal.deal_stage;
                await adminClient
                    .from('crm_deals')
                    .update({
                    deal_stage: targetDealStage,
                    deal_amount: effectiveDealAmount || existingDeal.deal_amount,
                    deal_owner_id: matchedUserId,
                    description: planData ? dealDesc : (existingDeal.description || dealDesc),
                    updated_at: new Date().toISOString(),
                })
                    .eq('id', dealId);
            }
        }
        else {
            // Create new deal
            const dealName = planData
                ? `${planData.plan_name} - ${rawFullName}`
                : `باقة Tungsten Enterprise - ${rawFullName}`;
            const { data: newDeal, error: dealErr } = await adminClient
                .from('crm_deals')
                .insert({
                workspace_id: workspaceId,
                deal_name: dealName,
                deal_stage: targetDealStage,
                deal_amount: effectiveDealAmount,
                currency: 'EGP',
                deal_owner_id: matchedUserId,
                created_by: matchedUserId,
                description: dealDesc,
            })
                .select('id')
                .single();
            if (newDeal) {
                dealId = newDeal.id;
                await adminClient.from('crm_deal_contacts').insert({
                    workspace_id: workspaceId,
                    deal_id: dealId,
                    contact_id: contactId,
                    is_primary: true,
                });
            }
        }
        // 7. Record Rich History & Activities in Client Profile ("ويتضاف ف البروفايل بتاعه الحاجات الي حصلت علشان بقي عميل الهيستوري وكمان مين تابع معاه")
        let activityTitle = 'تحديث بيانات ومتابعة عبر SocialLens';
        let activityDetails = '';
        if (isWon) {
            activityTitle = '🎉 ترقية إلى عميل رسمي معتمد (SocialLens)';
            activityDetails = [
                `🏆 تم اعتماد العميل ونقله بنجاح من مسار العملاء المحتملين إلى الصفقات المعتمدة (Won Deals).`,
                `👤 مسؤول المتابعة والمبيعات: ${repDisplayName}`,
                `🏷️ المرحلة الحالية: [${targetDealStage}] • حالة العميل: [${targetLeadStatus}]`,
                `💰 قيمة الصفقة/العقد: ${rawDealAmount.toLocaleString('ar-EG')} ج.م`,
                rawNotes ? `📝 ملاحظات مسجلة من موقع السيلز: ${rawNotes}` : '',
                `🌐 المنصة المصدر: SocialLens Webhook (${event})`,
            ].filter(Boolean).join('\n');
        }
        else if (isCreatedNew) {
            activityTitle = '📥 استقبال ليد جديد من منصة SocialLens';
            activityDetails = [
                `✨ تم تسجيل العميل المحتمل لأول مرة في النظام بنجاح.`,
                `👤 مسؤول المتابعة المعين: ${repDisplayName}`,
                `📌 المصدر: ${rawSource} • معرف الإعلان: ${rawAdId}`,
                `📞 الهاتف: ${rawPhone}`,
                rawNotes ? `📝 تفاصيل الطلب: ${rawNotes}` : '',
            ].filter(Boolean).join('\n');
        }
        else {
            activityTitle = '🔄 تحديث حالة العميل عبر SocialLens';
            activityDetails = [
                `تحديث حالة المتابعة عبر SocialLens Webhook.`,
                `👤 مسؤول المتابعة: ${repDisplayName}`,
                `الحالة السابقة: [${oldLeadStatus || 'جديد'}] ➔ الحالة الحالية: [${targetLeadStatus}]`,
                `المرحلة الحالية: [${targetDealStage}] • حالة النشاط: [${targetActivityStatus}]`,
                rawNotes ? `📝 ملاحظات المتابعة: ${rawNotes}` : '',
            ].filter(Boolean).join('\n');
        }
        await adminClient.from('crm_activities').insert({
            workspace_id: workspaceId,
            contact_id: contactId,
            deal_id: dealId,
            activity_type: isWon ? 'ملاحظة' : 'متابعة',
            title: activityTitle,
            details: activityDetails,
            assigned_user_id: matchedUserId,
            completion_status: isWon ? 'مكتمل' : 'قيد الانتظار',
            due_date: isWon ? null : (payload.follow_up_date || new Date().toISOString()),
            performed_at: new Date().toISOString(),
            created_by: matchedUserId,
        });
        // 7.1 Record Subscribed Plan Deliverables Activity (SocialLens Offer)
        if (planData && isWon) {
            const servicesListText = planData.services
                .map((s) => `• ${s.title} (${s.quantity}×) - ${Number(s.total_price).toLocaleString('ar-EG')} ج.م: ${s.description || 'مخرجات معتمدة'}`)
                .join('\n');
            await adminClient.from('crm_activities').insert({
                workspace_id: workspaceId,
                contact_id: contactId,
                deal_id: dealId,
                activity_type: 'ملاحظة',
                title: `📦 باقة ومخرجات الخطة المعتمدة (${planData.plan_code})`,
                details: [
                    `💎 الباقة المشترك بها: ${planData.plan_name} (${planData.pricing_location})`,
                    `💰 القيمة: ${Number(planData.price).toLocaleString('ar-EG')} ج.م / ${planData.billing_cycle}`,
                    `🎯 الهدف الاستراتيجي للخطة: ${planData.strategy_goal}`,
                    `📋 المخرجات والخدمات المتضمنة (${planData.services.length} خدمات):\n${servicesListText}`,
                    `🔍 تشخيص الحساب: ${planData.diagnostics?.platform || 'YouTube'} ${planData.diagnostics?.account || ''} (معدل التفاعل: ${planData.diagnostics?.engagement_rate || '0.5%'})`,
                ].join('\n\n'),
                assigned_user_id: matchedUserId,
                completion_status: 'مكتمل',
                performed_at: new Date().toISOString(),
                created_by: matchedUserId,
            });
        }
        // If SocialLens passed historical timeline array (`history` or `activities`)
        const historyList = payload.history || payload.activities || [];
        if (Array.isArray(historyList) && historyList.length > 0) {
            for (const h of historyList) {
                const hTitle = h.title || h.name || 'ملاحظة سابقة مسجلة';
                const hType = (h.type === 'مكالمة' || h.type === 'اجتماع' || h.type === 'ملاحظة') ? h.type : 'ملاحظة';
                const hDetails = h.details || h.notes || '';
                const hAuthor = h.author || h.performed_by || repDisplayName;
                const hTime = h.timestamp || h.date || new Date().toISOString();
                await adminClient.from('crm_activities').insert({
                    workspace_id: workspaceId,
                    contact_id: contactId,
                    deal_id: dealId,
                    activity_type: hType,
                    title: `[SocialLens History] ${hTitle}`,
                    details: `${hDetails}\n👤 مسؤول النشاط: ${hAuthor}`,
                    assigned_user_id: matchedUserId,
                    completion_status: 'مكتمل',
                    due_date: hType === 'اجتماع' ? (h.due_date || hTime) : null,
                    start_date: hType === 'اجتماع' ? (h.start_date || hTime) : null,
                    meeting_status: hType === 'اجتماع' ? normalizeMeetingStatus(h.meeting_status || 'حضر') : null,
                    performed_at: hTime,
                    created_by: matchedUserId,
                });
            }
        }
        // 8. Record in crm_audit_logs
        const auditAction = isWon || (oldDealStage && oldDealStage !== targetDealStage) ? 'STAGE_CHANGE' : (isCreatedNew ? 'INSERT' : 'UPDATE');
        await adminClient.from('crm_audit_logs').insert({
            workspace_id: workspaceId,
            original_workspace_id: workspaceId,
            workspace_type: 'tungsten_internal',
            entity_type: 'crm_contacts',
            entity_id: contactId,
            action: auditAction,
            old_values: {
                lead_status: oldLeadStatus,
                deal_stage: oldDealStage,
            },
            new_values: {
                lead_status: targetLeadStatus,
                deal_stage: targetDealStage,
                source: 'SocialLens Webhook',
                sales_rep: repDisplayName,
                event,
                is_won: isWon,
            },
            performed_by: matchedUserId,
        });
        // 9. Save in In-Memory Webhook Logs cache
        const successEntry = {
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            workspace_id: workspaceId,
            timestamp: new Date().toISOString(),
            event,
            status: 'success',
            status_code: 200,
            contact_id: contactId,
            contact_name: existingContact?.full_name || rawFullName,
            lead_id: rawLeadId,
            deal_id: dealId || undefined,
            sales_rep: repDisplayName,
            is_won: isWon,
            lead_status: targetLeadStatus,
            deal_stage: targetDealStage,
            message: isWon
                ? `تمت ترقية العميل إلى عميل نشط رسمي ونقله للديلز وتثبيت مخرجات الباقة (${planData?.plan_code || 'SL-OFFER'}) بنجاح`
                : (isCreatedNew ? 'تم استلام الليد الجديد وتسجيله في مسار المبيعات بنجاح' : 'تم تحديث بيانات ومتابعة العميل بنجاح'),
            payload: rawBody,
        };
        addWebhookLog(successEntry);
        return res.status(200).json({
            success: true,
            message: successEntry.message,
            data: {
                contact_id: contactId,
                deal_id: dealId,
                lead_id: rawLeadId,
                lead_status: targetLeadStatus,
                deal_stage: targetDealStage,
                is_won: isWon,
                sales_rep: repDisplayName,
                plan_details: planData,
                timeline_recorded: true,
            },
        });
    }
    catch (err) {
        console.error('[SocialLens Webhook Error]', err);
        const errorEntry = {
            id: `err-${Date.now()}`,
            workspace_id: workspaceId || 'unknown',
            timestamp: new Date().toISOString(),
            event,
            status: 'error',
            status_code: 500,
            is_won: false,
            lead_status: 'error',
            deal_stage: 'error',
            message: `خطأ في معالجة الويب هوك: ${err.message}`,
            payload: rawBody,
        };
        addWebhookLog(errorEntry);
        return res.status(500).json({ error: err.message });
    }
});
//# sourceMappingURL=sociallens-webhook.js.map